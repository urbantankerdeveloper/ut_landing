declare global { namespace Express { interface Request { authUser?: { id: string; email?: string }; profile?: { id: string; role: string; full_name: string }; vendorId?: string } } }
export {}
