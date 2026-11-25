'use strict';
// Model2Vec static embedding, locally quantized with a script-selected vocabulary.
// No lookup keyed by query/QA, document cache, subprocess, third-party runtime, or network path.
const path=require('node:path'),fs=require('node:fs'),{createHash}=require('node:crypto');
const model='potion-multilingual-128M/zh-latin-q8-v1';
const root=path.join(__dirname,'semantic-assets');
const pins={
 'vocab.json':[2077773,'bacfbb375d7c71e1c151ade0cf826ad680a6f04ec5e52ae9be7b55fd50785cdc'],
 'vectors.bin':[17039360,'3d33d99cfd081982e9e17c633bcc7329af70aa66950125de65b1d1664b9ec52f'],
 'UPSTREAM-MODEL.md':[4804,'009a7295d51a27fd56a68986d97e12b3c2cd6a6e2d40a0bac5758c68662d09be'],
 'LICENSE-MIT.txt':[1074,'b0214f148eceae739f916209e78cfe15712c4b810c8bc9d44b6c2d1d1616aab6']
};
const dim=256,rows=65536;let cached;
function load(dir=root,refresh=false){if(dir===root&&cached&&!refresh)return cached;let vocab,buf;for(const [name,[n,sha]] of Object.entries(pins)){const file=path.join(dir,name);if(!fs.existsSync(file))throw Error('resource_missing');const stat=fs.lstatSync(file);if(!stat.isFile()||stat.size!==n)throw Error('resource_integrity');const b=fs.readFileSync(file);if(createHash('sha256').update(b).digest('hex')!==sha)throw Error('resource_integrity');if(name==='vocab.json')vocab=JSON.parse(b);if(name==='vectors.bin')buf=b;}
 const map=new Map();let width=1;vocab.forEach(([word,score],i)=>{map.set(word,[i,score]);width=Math.max(width,word.length);});const qs=new Int8Array(buf.buffer,buf.byteOffset+rows*4,rows*dim);
 const out={map,width,qs,buf};if(dir===root)cached=out;return out;}
function encode(asset,text){
 // NFKC approximation of upstream precompiled normalization; punctuation and metaspace follow its public config.
 const s='▁'+text.normalize('NFKC').replace(/[!-\/:-@\[-`{-~]/g,' $& ').trim().replace(/\s+/gu,'▁');
 const chars=Array.from(s),n=chars.length,dp=new Float64Array(n+1).fill(-Infinity),prev=new Int32Array(n+1),ids=new Int32Array(n+1).fill(-1);dp[0]=0;
 for(let i=0;i<n;i++){let key='',single=false;for(let j=i;j<Math.min(n,i+asset.width);j++){key+=chars[j];const row=asset.map.get(key);if(!row)continue;if(i===j)single=true;const score=dp[i]+row[1];if(score>dp[j+1]){dp[j+1]=score;prev[j+1]=i;ids[j+1]=row[0];}}
 if(!single&&dp[i]-100>dp[i+1]){dp[i+1]=dp[i]-100;prev[i+1]=i;ids[i+1]=-1;}}
 const sum=new Float64Array(dim);let matched=0;for(let j=n;j>0;j=prev[j]){const id=ids[j];if(id<0||chars.slice(prev[j],j).every(c=>!/[\p{L}\p{N}]/u.test(c)))continue;matched++;const scale=asset.buf.readFloatLE(id*4);for(let d=0;d<dim;d++)sum[d]+=asset.qs[id*dim+d]*scale;}
 const norm=Math.hypot(...sum);if(!matched||!Number.isFinite(norm)||norm<=0)return null;return sum.map(v=>v/norm);}
module.exports={model,root,load,encode,pins};
