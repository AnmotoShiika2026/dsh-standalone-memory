'use strict';
// Only de-escalate to a local veto; never turn a privacy signal into permission.
// The whole-message forget grammar still authenticates the target on its own.
const forget=require('./curated-forget.cjs');
const verb='(?:删除|删掉|删去|撤回|收回|抹掉|清除|清空|遗忘|忘掉)', aspect='(?:早已|已经|曾经|曾|已|先前|之前|此前|上次|昨天|当时)';
const past=new RegExp(`(?:${aspect}(?:被|经我|由我)?${verb}(?:过|了)?|被${verb}(?=的|过|了)|${verb}(?:过|了)(?=的|那|这|$)|${verb}(?=的(?:原话|话|消息|内容|记录|那条|那句)))`,'gu');
const grant=/^(?:我(?:现在|这次|明确)?|现在我)?(?:允许|同意|授权)(?:你)?(?:重新|再次|继续)?(?:保存|记录|留存|存储|记住)/u;
const local=/^(?:这(?:一)?句(?:话)?|这条(?:消息)?|本条)?(?:请)?(?:不要|不用|别|请勿|勿|禁止)(?:再)?(?:保存|记录|留存|存储|记住)(?:这(?:一)?句(?:话)?|这条(?:消息)?)?$/u;
function controlIntent(t){const parts=t.split(/[。！？!?；;，,\n]+/u).map(x=>x.trim()).filter(Boolean);if(!parts.length)return null;
 const kinds=parts.map(c=>{if(forget.request(c))return 'target';if(local.test(c))return 'refusal';const rest=c.replace(past,' ');if(new RegExp(verb,'u').test(rest))return 'other';if(grant.test(c))return 'grant';return rest!==c?'history':'other';});
 // No individual target in a composite turn grants a deletion capability.
 if(parts.length>1&&kinds.includes('target'))return 'mixed';
 if(kinds.includes('other')||kinds.includes('target'))return null;
 return kinds.includes('refusal')?'refusal':kinds.includes('grant')?'grant':'history';
}
module.exports={controlIntent};
