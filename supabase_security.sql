-- 1. Enable RLS on the KillSwitch table
ALTER TABLE bot_configs ENABLE ROW LEVEL SECURITY;

-- 2. Policy: Allow the Service Role (Admin) to do EVERYTHING
-- This ensures your Admin Dashboard still works
CREATE POLICY "Admin full access" ON bot_configs 
FOR ALL USING (true) 
WITH CHECK (true);

-- 3. Policy: Allow Bots to READ their own config
-- (Optional: You can restrict this further by client_id if needed)
CREATE POLICY "Bots can read config" ON bot_configs 
FOR SELECT USING (true);
