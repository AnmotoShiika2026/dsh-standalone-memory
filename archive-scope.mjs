// No topic dictionary. Parse the entire authority sentence first. A suffix is a
// boolean veto, never a supplier of dates, roles, workspace, actions or grants.
import {policyReadDenied} from './forget-host.mjs';
const day='(\\d{4}-\\d{2}-\\d{2})';const head=new RegExp('^(?:请)?回查本工作区 *'+day+'(?: *至 *'+day+')? *的(用户|助手)?聊天记录[。？?]?$','u');
const valid=s=>{const d=new Date(s+'T00:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===s};
const risk=/不要|不用|不必|不准|不得|不许|不应|(?<!分)别|禁止|取消|忽略|撤|作废|忘|停|仅限|只查|改查|先不|免查|不查|拒绝|并非|假设|如果|示例|举例|比如|引用|复述|翻译|改写|转述|照读|念出|模板|这句话|句子|指令|命令|提示词|记录之外|工作区|项目以外|整个项目|目录|其他项目|另一项目|别的项目|跨项目|账号|账户|角色|用户|助手|系统|工具|权限|授权|聊天记录|归档|检索|搜|查|翻阅|浏览|调取|读取|打开|开启|关闭|下载|传输|发送|转发|复制|粘贴|导出|记录到|保存|存储|写入|删除|清空|执行|运行|调用|联网|发布|发给|分享|公开|代替|越过|绕过|请|帮我|顺便|另外|再把|然后|昨天|昨日|明天|前天|今天|上周|上月|上年|去年|下周|下月|本周|本月|今年|[零〇一二三四五六七八九十百千两]+[年月日号]|所有日期|其他日期|不限日期|以往|以前的记录|全部记录|所有记录/u;
// Strip at most one complete, terminal answer-only constraint. Never strip read vetoes.
const answerGuard=/(?:如果|若)(?:缺任一方原文|缺少一方原文|缺少任一方原文|双方原文不全)，(?:不要|不能|不得)判断先后。$/u;
function questions(s){const g=s.match(answerGuard);if(g){if(!g.index||!/[？?]/u.test(s[g.index-1]))return false;s=s.slice(0,g.index);}if(s.length>130||risk.test(s)||!s.endsWith('？')&&!s.endsWith('?'))return false;const parts=s.slice(0,-1).split(/[？?]/u);return parts.length<=2&&parts.every(p=>/^[\p{Script=Han}]+(?:，[\p{Script=Han}]+)?$/u.test(p)&&(/(?:什么|哪个|哪种|哪些|哪项|哪里|哪位|多少|几[个项种份次]|谁|怎么|如何|有没有|是否|为何|为什么)/u.test(p)||/^我现在选的是哪条路线$/u.test(p)||/^(?:[\p{Script=Han}]{1,6}的[\p{Script=Han}]{1,4})?我(?:已经)?(?:定下来|定稿|确认|决定)了吗$/u.test(p)));}
export function parseArchiveScope(text,approved){if(typeof text!=='string'||text.length>256||policyReadDenied(text)||/[\p{C}\p{Zl}\p{Zp}]/u.test(text))return null;
const i=text.indexOf('。'),cmd=i<0?text:text.slice(0,i+1),q=i<0?'':text.slice(i+1);const m=head.exec(cmd);if(!m||!approved(cmd)||!valid(m[1])||(m[2]&&(!valid(m[2])||m[1]>m[2]))||(q&&!questions(q)))return null;
return {from:m[1],to:m[2]??m[1],role:({用户:'user',助手:'assistant'})[m[3]]};}
export const notRequested=()=>({status:'not_requested',searched:false,coverage:'not_evaluated',message:'本次请求或工具参数不满足读取门，未执行检索；不能推断有无记录。'});
