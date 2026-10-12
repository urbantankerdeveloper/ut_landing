import type { User } from '@supabase/supabase-js'
declare global { namespace Express { interface Request { authUser?: User; profile?: { id: string; role: string; full_name: string } } } }
export {}
