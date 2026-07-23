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

  if (!auth.isPremium) {
    return {
      statusCode: 403,
      body: JSON.stringify({ error: "premium_required", message: "Upgrade to Premium to unlock interactive Chef Voice Chat!" })
    };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 503,
      body: JSON.stringify({ error: "Gemini API key is not configured on this server." })
    };
  }

  try {
    const { recipeTitle, question } = JSON.parse(event.body);

    const prompt = `You are a helpful, expert Michelin-starred kitchen companion. 
      The user is currently cooking "${recipeTitle || 'a dish'}".
      They just asked you this question while cooking: "${question}".
      Provide a very brief, friendly, and helpful kitchen answer in exactly 1 or 2 sentences. Keep it under 30 words so it is easy to read and speak back.`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              answer: { type: "STRING" }
            },
            required: ["answer"]
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
      body: JSON.stringify({ error: error.message || "Failed to answer conversational question." })
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
