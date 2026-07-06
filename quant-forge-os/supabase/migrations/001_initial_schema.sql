-- ============================================================
-- QUANT FORGE - Full Trading App Schema
-- Run this in: https://supabase.com/dashboard/project/vdurrhxaffcszjfawfie/sql/new
-- ============================================================


-- ============================================================
-- 1. PROFILES (extends Supabase auth.users)
-- ============================================================
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  email TEXT,
  timezone TEXT DEFAULT 'America/New_York',
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================
-- 2. PORTFOLIOS
-- ============================================================
CREATE TABLE portfolios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL DEFAULT 'My Portfolio',
  total_equity DECIMAL(15,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================
-- 3. POSITIONS (Open trades)
-- ============================================================
CREATE TABLE positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID REFERENCES portfolios(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT,
  quantity INTEGER NOT NULL,
  entry_price DECIMAL(10,2) NOT NULL,
  current_price DECIMAL(10,2),
  pnl DECIMAL(10,2) DEFAULT 0,
  pnl_pct DECIMAL(6,2) DEFAULT 0,
  side TEXT CHECK (side IN ('LONG', 'SHORT')) DEFAULT 'LONG',
  risk_level TEXT CHECK (risk_level IN ('Low', 'Med', 'High')) DEFAULT 'Med',
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================
-- 4. ORDERS
-- ============================================================
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID REFERENCES portfolios(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  type TEXT NOT NULL CHECK (type IN ('LMT', 'MKT', 'STP', 'BRK')),
  quantity INTEGER NOT NULL,
  price DECIMAL(10,2),
  total DECIMAL(15,2),
  status TEXT NOT NULL CHECK (status IN ('Working', 'Filled', 'Canceled', 'Rejected')) DEFAULT 'Working',
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================
-- 5. TRADES / JOURNAL
-- ============================================================
CREATE TABLE trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('LONG', 'SHORT')),
  setup_type TEXT,
  entry_price DECIMAL(10,2),
  exit_price DECIMAL(10,2),
  quantity INTEGER,
  pnl DECIMAL(10,2),
  r_multiple DECIMAL(5,2),
  is_win BOOLEAN DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================
-- 6. WATCHLISTS
-- ============================================================
CREATE TABLE watchlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE watchlist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  watchlist_id UUID REFERENCES watchlists(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(watchlist_id, symbol)
);


-- ============================================================
-- 7. ALERTS
-- ============================================================
CREATE TABLE alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  symbol TEXT,
  kind TEXT CHECK (kind IN ('Breakout', 'News', 'Volatility', 'Stop', 'Portfolio')) DEFAULT 'Breakout',
  condition TEXT,
  target_value DECIMAL(10,2),
  message TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  is_triggered BOOLEAN DEFAULT FALSE,
  triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================
-- 8. USER SETTINGS
-- ============================================================
CREATE TABLE user_settings (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  notify_order_fills BOOLEAN DEFAULT TRUE,
  notify_breakout_alerts BOOLEAN DEFAULT TRUE,
  notify_ai_insights BOOLEAN DEFAULT TRUE,
  notify_email BOOLEAN DEFAULT TRUE,
  notify_push BOOLEAN DEFAULT TRUE,
  notify_telegram BOOLEAN DEFAULT FALSE,
  ibkr_api_key TEXT,
  openai_api_key TEXT,
  news_api_key TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================
-- 9. ROW LEVEL SECURITY (RLS) - Users only see their own data
-- ============================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

-- Profiles
CREATE POLICY "Users manage own profile" ON profiles FOR ALL USING (auth.uid() = id);

-- Portfolios
CREATE POLICY "Users manage own portfolios" ON portfolios FOR ALL USING (auth.uid() = user_id);

-- Positions
CREATE POLICY "Users manage own positions" ON positions FOR ALL USING (auth.uid() = user_id);

-- Orders
CREATE POLICY "Users manage own orders" ON orders FOR ALL USING (auth.uid() = user_id);

-- Trades
CREATE POLICY "Users manage own trades" ON trades FOR ALL USING (auth.uid() = user_id);

-- Watchlists
CREATE POLICY "Users manage own watchlists" ON watchlists FOR ALL USING (auth.uid() = user_id);

-- Watchlist Items
CREATE POLICY "Users manage own watchlist items" ON watchlist_items FOR ALL USING (auth.uid() = user_id);

-- Alerts
CREATE POLICY "Users manage own alerts" ON alerts FOR ALL USING (auth.uid() = user_id);

-- User Settings
CREATE POLICY "Users manage own settings" ON user_settings FOR ALL USING (auth.uid() = id);


-- ============================================================
-- 10. AUTO-CREATE PROFILE ON SIGNUP
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, display_name, email)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'display_name', NEW.email);

  INSERT INTO user_settings (id) VALUES (NEW.id);

  INSERT INTO portfolios (user_id, name) VALUES (NEW.id, 'My Portfolio');

  INSERT INTO watchlists (user_id, name) VALUES (NEW.id, 'My Watchlist');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
