require('dns').setDefaultResultOrder('ipv4first');

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method Not Allowed" })
    };
  }

  // --- Authentication Helper ---
  const auth = await checkPremiumStatus(event);
  if (!auth.authenticated) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: auth.error || "Unauthorized" })
    };
  }

  // --- Enforce Daily Limits for Free Tier ---
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  const authHeader = event.headers.authorization || event.headers.Authorization;

  if (supabaseUrl && supabaseAnonKey && !auth.isPremium) {
    const today = new Date().toISOString().split('T')[0];
    let dailyUsage = auth.profile ? auth.profile.daily_usage_count : 0;
    const lastReset = auth.profile ? auth.profile.last_reset_date : '';
    
    if (lastReset !== today) {
      dailyUsage = 0;
    }

    if (dailyUsage >= 3) {
      return {
        statusCode: 403,
        body: JSON.stringify({
          error: "limit_exceeded",
          message: "You have reached your daily limit of 3 free recipe generations. Please upgrade to Premium!"
        })
      };
    }

    const newCount = dailyUsage + 1;
    try {
      await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${auth.userId}`, {
        method: 'PATCH',
        headers: {
          'apikey': supabaseAnonKey,
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          daily_usage_count: newCount,
          last_reset_date: today
        })
      });
    } catch (err) {
      console.error("Failed to increment daily usage:", err);
    }
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 503,
      body: JSON.stringify({ error: "Gemini API key is not configured on this server." })
    };
  }

  try {
    const { listString, spicesString, preferencesText, seasoningsPromptText } = JSON.parse(event.body);

    const systemPrompt = `You are a world-class professional chef. Generate 2 distinct, creative, and delicious recipes that utilize some or all of the following available ingredients: [${listString}].
      ${preferencesText}
      ${seasoningsPromptText}
      Instructions:
      1. Provide a beautiful title and an enticing description for each recipe.
      2. Keep prep and cook times accurate and realistic.
      3. For the ingredient list of each recipe, mark each item with "owned": true if it is in the available ingredients list [${listString}] or in the seasonings list [${spicesString}] (allowing minor singular/plural variations), or "owned": false if the user needs to get it.
      4. Provide the correct category for each ingredient (must be one of: 'Produce', 'Meat & Seafood', 'Dairy & Eggs', 'P grains', 'Baking & Spices', 'Other').
      5. Prioritize using the ingredients marked as URGENT or EXPIRING SOON. Make a note in the description if you saved these items from going to waste.
      6. Provide clear, numbered steps. Set the "timer" property to an integer (duration in minutes) ONLY for passive waiting or duration-tracked events (like baking, roasting, simmering, boiling, preheating, or marinating). For active hand-on preparation steps that require no waiting (such as chopping, mixing, whisking, tossing, spreading, transferring, or garnishing), set "timer" to null.
      7. Estimate and include the macronutrients (protein, carbs, and fat, in grams) in the "macros" block based on the recipe ingredients.
      8. Return strictly a JSON array of objects conforming to the requested schema.`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: systemPrompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                title: { type: "STRING" },
                description: { type: "STRING" },
                prepTime: { type: "INTEGER" },
                cookTime: { type: "INTEGER" },
                calories: { type: "INTEGER" },
                macros: {
                  type: "OBJECT",
                  properties: {
                    protein: { type: "INTEGER" },
                    carbs: { type: "INTEGER" },
                    fat: { type: "INTEGER" }
                  },
                  required: ["protein", "carbs", "fat"]
                },
                ingredients: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      name: { type: "STRING" },
                      amount: { type: "STRING" },
                      owned: { type: "BOOLEAN" },
                      category: { type: "STRING" }
                    },
                    required: ["name", "amount", "owned", "category"]
                  }
                },
                steps: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      text: { type: "STRING" },
                      timer: { type: "INTEGER" }
                    },
                    required: ["text"]
                  }
                },
                tags: {
                  type: "ARRAY",
                  items: { type: "STRING" }
                }
              },
              required: ["title", "description", "prepTime", "cookTime", "calories", "macros", "ingredients", "steps", "tags"]
            }
          }
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return {
        statusCode: response.status,
        body: errText
      };
    }

    const data = await response.json();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || "Failed to generate recipes." })
    };
  }
};

async function checkPremiumStatus(event) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  
  if (!supabaseUrl || !supabaseAnonKey) {
    return { authenticated: true, isPremium: true };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader) {
    return { authenticated: false, isPremium: false, error: "Missing Authorization header." };
  }

  try {
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        'Authorization': authHeader,
        'apikey': supabaseAnonKey
      }
    });

    if (!userRes.ok) {
      return { authenticated: false, isPremium: false, error: "Invalid access token." };
    }

    const user = await userRes.json();

    const profileRes = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${user.id}`, {
      headers: {
        'apikey': supabaseAnonKey,
        'Authorization': authHeader
      }
    });

    if (!profileRes.ok) {
      return { authenticated: true, isPremium: false, userId: user.id };
    }

    const profiles = await profileRes.json();
    const profile = profiles[0];
    const isPremium = profile ? !!profile.is_premium : false;

    return { authenticated: true, isPremium, userId: user.id, profile };
  } catch (err) {
    console.error("Auth verification helper error:", err);
    return { authenticated: false, isPremium: false, error: "Internal authentication error." };
  }
}
