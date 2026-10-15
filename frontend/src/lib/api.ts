const connectionProblem = 'Connection problem. Your changes were not saved. Check your internet connection and try again.';
const serverProblem = 'The service is having trouble right now. Your changes may not have been saved. Wait a moment and try again.';

export async function request<T>(url:string, options:RequestInit = {}):Promise<T> {
  let response:Response;
  try { response = await fetch(`/api/v1${url}`,{...options,headers:{'Content-Type':'application/json',...options.headers}}); }
  catch { throw Object.assign(new Error(connectionProblem),{status:0,retryable:true}); }
  const isJson = (response.headers.get('content-type') ?? '').includes('json');
  const data = isJson ? await response.json().catch(() => null) : null;
  if (!response.ok) {
    if (data === null || response.status >= 502) throw Object.assign(new Error(serverProblem),{status:response.status,retryable:true});
    const error = new Error(Array.isArray(data.message) ? data.message.join('. ') : data.message ?? 'Request failed'); Object.assign(error,{status:response.status,code:data.code,details:data.details}); throw error;
  }
  if (data === null && response.status !== 204) throw Object.assign(new Error(serverProblem),{status:response.status,retryable:true});
  return data as T;
}
