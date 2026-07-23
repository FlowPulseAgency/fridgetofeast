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
          message: "You have reached your daily limit of 3 free operations. Please upgrade to Premium!"
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
    const { image, mimeType } = JSON.parse(event.body);

    if (!image) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing image content." })
      };
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: "Identify only the specific cooking ingredients you are highly confident about in this image. Do not guess generic food categories (such as 'grains', 'spices', or 'leftovers') or guess items that are blurry or partially hidden. If you are not completely sure about an item, omit it and do not list it. Return the results strictly as a JSON array of strings containing the item names, for example: [\"tomato\", \"cheese\", \"bell pepper\"]. Do not include markdown code block formatting or backticks. Return nothing but the JSON array."
              },
              {
                inlineData: {
                  mimeType: mimeType || "image/jpeg",
                  data: image
                }
              }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: "application/json"
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
      body: JSON.stringify({ error: error.message || "Failed to analyze image." })
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
