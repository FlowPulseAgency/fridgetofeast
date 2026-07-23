const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

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

  const { sessionId } = req.body;
  if (!sessionId) {
    return res.status(400).json({ error: "Missing sessionId" });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: "Supabase credentials not configured." });
  }

  try {
    // 1. Retrieve session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status === 'paid') {
      const userId = session.client_reference_id;
      
      // 2. Initialize Supabase Client
      const supabase = createClient(supabaseUrl, supabaseKey);

      // 3. Update user profile to premium
      const { data, error } = await supabase
        .from('profiles')
        .update({ is_premium: true })
        .eq('id', userId)
        .select()
        .single();

      if (error) throw error;

      return res.status(200).json({ success: true, profile: data });
    } else {
      return res.status(400).json({ success: false, error: "Payment not completed." });
    }
  } catch (error) {
    console.error("Verification failed:", error);
    return res.status(500).json({ error: error.message || "Verification failed." });
  }
};
