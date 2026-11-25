// Date/role authorization lives in the current genuine user event, never the model.
// Legacy fields are assertions, not filters. In a both-speaker request the old role
// field is redundant: search BOTH regardless, and report the effective scope.
export function boundQuery(scope,args){
 if(!scope||!args||Object.getPrototypeOf(args)!==Object.prototype&&Object.getPrototypeOf(args)!==null||Object.keys(args).some(k=>!['from','to','role','page'].includes(k)))return null;
 if(('from' in args&&args.from!==scope.from)||('to' in args&&args.to!==scope.to)||('role' in args&&(!['user','assistant'].includes(args.role)||scope.role!==undefined&&args.role!==scope.role)))return null;
 const page=args.page??1;if(!Number.isSafeInteger(page)||page<1||page>10000000)return null;
 return Object.freeze({from:scope.from,to:scope.to,...(scope.role===undefined?{}:{role:scope.role}),page});
}
