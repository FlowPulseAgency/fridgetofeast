# 🍳 Fridge-to-Feast | Production-Ready AI Kitchen Assistant

An AI-powered recipe generator, kitchen timer companion, and food waste reduction application. Take a photo of your refrigerator or type in your ingredients, and watch Google Gemini AI instantly plan recipes, check off cooking steps, and track your environmental waste savings!

This project features a **secure hybrid architecture**, allowing it to run either as a 100% client-side local file (zero configuration) or as a secure web app backed by a Node.js/Express proxy server with Stripe checkout subscriptions.

---

## ✨ Features

- **Multimodal Photo Scanning**: Upload an image or use your device's live camera to scan ingredients. Gemini's vision capability automatically parses items in your fridge (Premium tier).
- **Interactive Kitchen Timers**: Click start directly on preparation step cards to start visual countdown timers with built-in alarms (Premium tier).
- **Aisle-Categorized Shopping Lists**: Convert missing ingredients into department-sorted digital checklists (Premium tier).
- **Waste & Money Savings Tracker**: Gamify your kitchen! Every time you finish cooking a recipe, the app calculates how much money you saved by utilizing leftover ingredients.
- **Dual Verification Modes**:
  - **Local Client Mode**: Safe and private, runs directly from `index.html` by opening it. Prompts you to enter your own Gemini API key (stored securely in browser `localStorage`).
  - **Secure Production Mode**: Serves the application via a Node.js server. Proxies requests to hide your private keys and integrates Stripe payments.

---

## 🚀 How to Run the App (Two Methods)

### Method 1: Client-Side Local Mode (Easiest)
1. Double-click the **`index.html`** file to open it in Chrome, Edge, Safari, or Firefox.
2. Enter your Gemini API key in the Settings modal (top-right gear icon).
3. Test manual ingredient entry. Lock overlays will prompt you to upgrade (which unlocks instantly for local trials) to explore the Camera Vision, Timers, and Shopping Lists!

### Method 2: Secure Server Mode (Commercial / Hosting)
To run the server locally or prepare for live hosting (e.g., Render, Railway, Vercel):
1. Install Node.js on your computer (if not already installed).
2. Open your terminal in this directory and install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` and fill in your keys:
   ```bash
   GEMINI_API_KEY=your_google_ai_studio_api_key
   STRIPE_SECRET_KEY=your_stripe_secret_key_here
   ```
4. Start the server:
   ```bash
   npm start
   ```
5. Navigate to **`http://localhost:3000`** in your browser.

---

## 🔑 Setting Up Free API Keys

### 1. Google Gemini API Key
1. Visit [Google AI Studio](https://aistudio.google.com/).
2. Log in and click the blue **"Get API Key"** button.
3. Click **"Create API Key"** and copy the key string.

### 2. Stripe Payment Keys (Optional for Launch)
1. Go to the [Stripe Dashboard](https://dashboard.stripe.com/register).
2. Go to **Developers -> API keys** to grab your Secret Key (`sk_test_...`).
3. Set up a **Stripe Subscription Product** at $4.99/month, and the checkout flow will activate automatically.
