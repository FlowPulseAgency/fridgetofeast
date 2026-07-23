const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ error: "Supabase credentials not configured." });
  }

  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader) {
    return res.status(401).json({ error: "Missing Authorization header." });
  }

  try {
    // 1. Authenticate user with Supabase
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        'Authorization': authHeader,
        'apikey': supabaseAnonKey
      }
    });

    if (!userRes.ok) {
      return res.status(401).json({ error: "Invalid access token." });
    }

    const user = await userRes.json();

    // 2. Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      client_reference_id: user.id,
      customer_email: user.email,
      success_url: `${req.headers.origin || 'https://fridgetofeast.vercel.app'}/?stripe=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin || 'https://fridgetofeast.vercel.app'}/?stripe=cancel`,
    });

    return res.status(200).json({ id: session.id, url: session.url });
  } catch (error) {
    console.error("Stripe session creation failed:", error);
    return res.status(500).json({ error: error.message || "Failed to create checkout session." });
  }
};
