import { createClient } from "@supabase/supabase-js";
import { pairChannel } from "@/lib/constants";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Wait for this before opening a pair's channel. One from before (fast refresh, the
// connect screen) may still be closing: channel() would hand that one back, and once
// closed it drops every channel with its name - so the new one would go dead.
export async function closeOldPairChannel(pairId: string) {
    const old = supabase.getChannels().find((c) => c.topic === `realtime:${pairChannel(pairId)}`);
    if (old) await supabase.removeChannel(old);
}
