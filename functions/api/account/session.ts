import { json, getAccount, type AccountEnv } from "../../_lib/account-auth.ts";
export async function onRequestGet({request,env}:{request:Request;env:AccountEnv}) {
  try { const user=await getAccount(request,env); return json({authenticated:Boolean(user),user:user?{id:user.id,displayName:user.display_name,email:user.email,role:user.role}:null}); }
  catch { return json({authenticated:false,user:null},503); }
}
