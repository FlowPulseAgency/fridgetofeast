require('dns').setDefaultResultOrder('ipv4first');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const auth = await checkPremiumStatus(req);
  if (!auth.authenticated) {
    return res.status(401).json({ error: auth.error || "Unauthorized" });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  const authHeader = req.headers.authorization || req.headers.Authorization;

  if (supabaseUrl && supabaseAnonKey && !auth.isPremium) {
    const today = new Date().toISOString().split('T')[0];
    let dailyUsage = auth.profile ? auth.profile.daily_usage_count : 0;
    const lastReset = auth.profile ? auth.profile.last_reset_date : '';
    
    if (lastReset !== today) {
      dailyUsage = 0;
    }

    if (dailyUsage >= 3) {
      return res.status(403).json({
        error: "limit_exceeded",
        message: "You have reached your daily limit of 3 free operations. Please upgrade to Premium!"
      });
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
    return res.status(503).json({ error: "Gemini API key is not configured on this server." });
  }

  try {
    const { image, mimeType } = req.body;

    if (!image) {
      return res.status(400).json({ error: "Missing image content." });
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
                text: "Identify all specific cooking ingredients in this image. Split your response into: 1) ingredients you are highly confident about, and 2) items you see but are unsure about (e.g. blurry, partially hidden, or ambiguous). For the unsure items, describe their visual appearance and location, and write a helpful question asking the user to identify it (e.g. 'I see a red round item next to the milk. What is this item?'). Return strictly a JSON object conforming to the requested schema."
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
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              ingredients: {
                type: "ARRAY",
                items: { type: "STRING" }
              },
              clarifications: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    visualAppearance: { type: "STRING" },
                    location: { type: "STRING" },
                    question: { type: "STRING" }
                  },
                  required: ["visualAppearance", "location", "question"]
                }
              }
            },
            required: ["ingredients", "clarifications"]
          }
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).send(errText);
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to analyze image." });
  }
};

async function checkPremiumStatus(req) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  
  if (!supabaseUrl || !supabaseAnonKey) {
    return { authenticated: true, isPremium: true };
  }

  const authHeader = req.headers.authorization || req.headers.Authorization;
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
