/* ==========================================
   FRIDGE-TO-FEAST SECURE EXPRESS BACKEND
   ========================================== */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || '');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Support base64 image uploads

// Serve static frontend files
app.use(express.static(path.join(__dirname)));

if (process.env.GEMINI_API_KEY) {
  console.log("Gemini API Key configured on server.");
} else {
  console.warn("WARNING: GEMINI_API_KEY is not defined in environment variables. Backend AI features will be disabled.");
}

// 1. Health Check Endpoint (Frontend Fallback Checker)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    mode: 'production',
    geminiConfigured: !!process.env.GEMINI_API_KEY,
    stripeConfigured: !!process.env.STRIPE_SECRET_KEY
  });
});

// 2. Vision Ingredient Extractor Endpoint
app.post('/api/analyze-image', async (req, res) => {
  const { image, mimeType } = req.body;

  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({ error: "Gemini API key is not configured on this server." });
  }

  if (!image) {
    return res.status(400).json({ error: "Missing image content." });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
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
      throw new Error(`Google API responded with status ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (rawText) {
      const parsed = JSON.parse(rawText.trim());
      res.json(parsed);
    } else {
      res.status(500).json({ error: "Failed to extract ingredients from Gemini output." });
    }
  } catch (error) {
    console.error("Analyze image proxy error:", error);
    res.status(500).json({ error: error.message || "Failed to analyze image." });
  }
});

// 3. AI Recipe Generator Endpoint (Structured JSON Output)
app.post('/api/generate-recipes', async (req, res) => {
  const { ingredients, dietaryOptions, mealType, prepTimeMax, seasonings } = req.body;

  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({ error: "Gemini API key is not configured on this server." });
  }

  if (!ingredients || !ingredients.length) {
    return res.status(400).json({ error: "Ingredients list is required." });
  }

  // Pre-process list to indicate item urgency / expiration
  const listItems = ingredients.map(ing => {
    if (ing.state === 'urgent') return `${ing.name} (URGENT: EXPIRING TODAY - MUST USE)`;
    if (ing.state === 'expiring') return `${ing.name} (EXPIRING SOON - PREFER USING)`;
    return ing.name;
  });
  const listString = listItems.join(', ');
  
  const activeSpices = seasonings || [];
  const spicesString = activeSpices.join(', ');

  let preferencesText = "";
  if (dietaryOptions && dietaryOptions.length) {
    preferencesText += `Dietary constraints: must be ${dietaryOptions.join(', ')}. `;
  }
  if (mealType && mealType !== 'any') {
    preferencesText += `Meal category: ${mealType}. `;
  }
  if (prepTimeMax && prepTimeMax !== 'any') {
    preferencesText += `Maximum preparation + cooking time must be strictly under ${prepTimeMax} minutes. `;
  }

  let seasoningsPromptText = "";
  if (activeSpices.length) {
    seasoningsPromptText = `You may assume the user has access to these seasonings and pantry staples: [${spicesString}]. Use them freely to make the recipe flavorful without marking them as unowned. For any other seasoning, spice, oil, or condiment that is NOT in this seasonings list, you must mark it as "owned": false so the user knows they need to buy it.`;
  } else {
    seasoningsPromptText = `Do not assume the user has access to any spices, seasonings, or oils. If a recipe needs any seasoning or oil, mark it as "owned": false unless it's in the available ingredients list [${listString}].`;
  }

  const systemPrompt = `You are a world-class professional chef. Generate 2 distinct, creative, and delicious recipes that utilize some or all of the following available ingredients: [${listString}].
    ${preferencesText}
    ${seasoningsPromptText}
    Instructions:
    1. Provide a beautiful title and an enticing description for each recipe.
    2. Keep prep and cook times accurate and realistic.
    3. For the ingredient list of each recipe, mark each item with "owned": true if it is in the available ingredients list [${listString}] or in the seasonings list [${spicesString}] (allowing minor singular/plural variations), or "owned": false if the user needs to get it.
    4. Provide the correct category for each ingredient (must be one of: 'Produce', 'Meat & Seafood', 'Dairy & Eggs', 'Pantry & Grains', 'Baking & Spices', 'Other').
    5. Prioritize using the ingredients marked as URGENT or EXPIRING SOON. Make a note in the description if you saved these items from going to waste.
    6. Provide clear, numbered steps. Set the "timer" property to an integer (duration in minutes) ONLY for passive waiting or duration-tracked events (like baking, roasting, simmering, boiling, preheating, or marinating). For active hand-on preparation steps that require no waiting (such as chopping, mixing, whisking, tossing, spreading, transferring, or garnishing), set "timer" to null.
    7. Estimate and include the macronutrients (protein, carbs, and fat, in grams) in the "macros" block based on the recipe ingredients.
    8. Return strictly a JSON array of objects conforming to the requested schema.`;

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: systemPrompt }]
          }
        ],
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
      throw new Error(`Google API responded with status ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (rawText) {
      res.json(JSON.parse(rawText.trim()));
    } else {
      res.status(500).json({ error: "Failed to generate recipes from Gemini output." });
    }
  } catch (error) {
    console.error("Recipe generation proxy error:", error);
    res.status(500).json({ error: error.message || "Failed to generate recipes." });
  }
});

// 4. AI Ingredient Dynamic Swapping Endpoint
app.post('/api/swap-ingredient', async (req, res) => {
  const { recipeTitle, oldIngredient, newIngredient, currentSteps } = req.body;

  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({ error: "Gemini API key is not configured on this server." });
  }

  const prompt = `You are a professional chef. We have a recipe named "${recipeTitle}" with these instructions:
    ${JSON.stringify(currentSteps)}
    
    The user wants to substitute the ingredient "${oldIngredient}" with "${newIngredient}".
    Rewrite the preparation steps array. Adjust the cooking instructions, timings, or actions in each step only if necessary to accommodate the new ingredient (e.g. if swapping chicken for tofu, adjust cooking steps to ensure tofu is handled correctly).
    Keep the same number of steps.
    Each step must be an object with:
    - "text" (rewritten instruction string)
    - "timer" (integer representing duration in minutes, or null if no timer is needed)

    Return strictly a JSON array containing these steps, conforming to the schema of array of step objects.`;

  try {
    const apiKey = process.env.GEMINI_API_KEY;
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
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                text: { type: "STRING" },
                timer: { type: "INTEGER" }
              },
              required: ["text"]
            }
          }
        }
      })
    });

    if (!response.ok) throw new Error(await response.text());
    
    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (rawText) {
      res.json(JSON.parse(rawText.trim()));
    } else {
      res.status(500).json({ error: "Failed to recalculate steps." });
    }
  } catch (error) {
    console.error("Ingredient swap proxy error:", error);
    res.status(500).json({ error: error.message || "Failed to swap ingredient." });
  }
});

// 5. Michelin Plating Guide Generator Endpoint
app.post('/api/generate-plating', async (req, res) => {
  const { recipeTitle, description, ingredients } = req.body;

  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({ error: "Gemini API key is not configured on this server." });
  }

  const prompt = `You are a Michelin-starred head chef. Design a plating and presentation guide for the dish "${recipeTitle}" (${description}).
    The ingredients are: ${JSON.stringify(ingredients.map(i => i.name))}.
    
    Provide your plating instructions in standard JSON format containing a list of sections. Each section must have:
    - "title" (the part of presentation, e.g. "Color Theme & Dinnerware Selection", "Plating Architecture", "Garnishing Details", "Texture & Contrast Tips")
    - "tips" (array of strings, each being a detailed plating instruction or suggestion)

    Return strictly a JSON array of objects with "title" and "tips".`;

  try {
    const apiKey = process.env.GEMINI_API_KEY;
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
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                title: { type: "STRING" },
                tips: {
                  type: "ARRAY",
                  items: { type: "STRING" }
                }
              },
              required: ["title", "tips"]
            }
          }
        }
      })
    });

    if (!response.ok) throw new Error(await response.text());
    
    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (rawText) {
      res.json(JSON.parse(rawText.trim()));
    } else {
      res.status(500).json({ error: "Failed to generate plating details." });
    }
  } catch (error) {
    console.error("Plating guide proxy error:", error);
    res.status(500).json({ error: error.message || "Failed to generate plating instructions." });
  }
});

// 6. Create Stripe Checkout Session
app.post('/api/create-checkout-session', async (req, res) => {
  if (!process.env.STRIPE_SECRET_KEY) {
    console.log("Stripe not configured. Returning mock payment success redirection.");
    const origin = req.headers.origin || `http://localhost:${PORT}`;
    return res.json({ url: `${origin}/?success=true` });
  }

  const origin = req.headers.origin || `http://localhost:${PORT}`;

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Fridge-to-Feast Premium Plan',
              description: 'Unlimited AI Recipe Generation & Kitchen Timers',
            },
            unit_amount: 499, // $4.99 USD
            recurring: {
              interval: 'month',
            },
          },
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${origin}/?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/`,
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error("Stripe session creation error:", error);
    res.status(500).json({ error: "Failed to initialize Stripe checkout session." });
  }
});

// 7. Verify Stripe Subscription Session
app.get('/api/verify-session', async (req, res) => {
  const { session_id } = req.query;

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.json({ success: true, mock: true });
  }

  if (!session_id) {
    return res.status(400).json({ error: "Session ID is required." });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.payment_status === 'paid') {
      res.json({ success: true, customer: session.customer_details?.email });
    } else {
      res.json({ success: false, status: session.payment_status });
    }
  } catch (error) {
    console.error("Stripe session retrieval error:", error);
    res.status(500).json({ error: "Failed to verify payment session." });
  }
});

// Start Express Server
app.listen(PORT, () => {
  console.log(`=================================================`);
  console.log(`Fridge-to-Feast secure backend listening on PORT ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
  console.log(`=================================================`);
});
