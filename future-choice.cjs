'use strict';
// Closed activity grammar: an arbitrary Han sequence is not a self-owned activity.
// A value is an explicitly named material in this first, deliberately limited family.
const acts='(串珠|编绳)', material='([银绿红蓝白黑金棕紫青黄透明]{1,2}(?:鱼线|丝线|棉线|蜡线|尼龙线|麻线))';
const future=new RegExp('^从下周一起我'+acts+'改用'+material+'。$','u');
const standing=new RegExp('^我'+acts+'时习惯用'+material+'。$','u');
const question=new RegExp('^我现在'+acts+'习惯用什么线[？?]$','u');
function monday(ms,zone){
 if(zone!=='Asia/Shanghai'||!Number.isSafeInteger(ms)||ms<Date.UTC(2000,0,1)||ms>=Date.UTC(2100,0,1))return null;
 const day=86400000,shift=28800000,local=Math.floor((ms+shift)/day),weekday=new Date(local*day).getUTCDay()||7;
 return (local+8-weekday)*day-shift;
}
function parse(re,s){const m=typeof s==='string'&&re.exec(s);return m&&m[0]===s?{activity:m[1],value:m[2]}:null;}
module.exports={monday,future:s=>parse(future,s),standing:s=>parse(standing,s),question:s=>parse(question,s)};
