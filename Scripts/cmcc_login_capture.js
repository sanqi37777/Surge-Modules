// cmcc_login_capture.js — 中国移动登录信封抓取（Loon 版）
// 用途: 抓中国移动 App 的 autoLogin 请求体, 解出登录信封, 存进 BoxJS (键 cmcc_login),
// 供 ByteValley 移动小组件 (Scripting) 点「从 BoxJS 导入」读取。
// 注意: 小组件自带的 Loon 插件 (ChinaMobile.lpx, 10086.js) 只存 china_mobile_cookie,
// 不写 cmcc_login, 所以按小组件的提示装那个插件是抓不到凭证的; 这个脚本才写 cmcc_login。
// 解密部分 (md5/AES-128-CBC/base64) 与小组件 shared/cmcc/crypto.ts 同一份实现,
// 请求体是 AES 加密的 base64 时用登录密钥 LK/LIV 解; 明文 JSON 时直接存。
// 只在首次抓到或换号时通知一次; 同号只换了 cellNum 的静默更新, 不打扰。

// cmcc / crypto.ts
// 纯 JS 的 md5 / AES-128-CBC / base64 / RSA (Scripting 的 Crypto 没有 AES-CBC)
// 与 paperclip/app/cmcc/cmcc.js 同一份实现, 已对真实接口验证
function u8(s){if(s instanceof Uint8Array)return s;const o=[];for(let i=0;i<s.length;i++){let c=s.charCodeAt(i);if(c>=0xd800&&c<0xdc00&&i+1<s.length){const d=s.charCodeAt(i+1);if(d>=0xdc00&&d<0xe000){c=0x10000+((c-0xd800)<<10)+(d-0xdc00);i++;}}if(c<0x80)o.push(c);else if(c<0x800)o.push(0xc0|(c>>6),0x80|(c&63));else if(c<0x10000)o.push(0xe0|(c>>12),0x80|((c>>6)&63),0x80|(c&63));else o.push(0xf0|(c>>18),0x80|((c>>12)&63),0x80|((c>>6)&63),0x80|(c&63));}return new Uint8Array(o);}
function u8s(b){let s='';for(let i=0;i<b.length;){const c=b[i++];let cp;if(c<0x80)cp=c;else if(c<0xe0)cp=((c&31)<<6)|(b[i++]&63);else if(c<0xf0)cp=((c&15)<<12)|((b[i++]&63)<<6)|(b[i++]&63);else cp=((c&7)<<18)|((b[i++]&63)<<12)|((b[i++]&63)<<6)|(b[i++]&63);if(cp>0xffff){cp-=0x10000;s+=String.fromCharCode(0xd800+(cp>>10),0xdc00+(cp&1023));}else s+=String.fromCharCode(cp);}return s;}
function toHex(b){let s='';for(let i=0;i<b.length;i++)s+=b[i].toString(16).padStart(2,'0');return s;}
const B64A='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function b64(b){let s='',i=0;for(;i+2<b.length;i+=3){const n=(b[i]<<16)|(b[i+1]<<8)|b[i+2];s+=B64A[(n>>18)&63]+B64A[(n>>12)&63]+B64A[(n>>6)&63]+B64A[n&63];}if(i<b.length){const n=(b[i]<<16)|((i+1<b.length?b[i+1]:0)<<8);s+=B64A[(n>>18)&63]+B64A[(n>>12)&63]+(i+1<b.length?B64A[(n>>6)&63]:'=')+'=';}return s;}
function b64dec(s){s=String(s).replace(/[^A-Za-z0-9+/]/g,'');const out=[];let buf=0,bits=0;for(const ch of s){buf=(buf<<6)|B64A.indexOf(ch);bits+=6;if(bits>=8){bits-=8;out.push((buf>>bits)&0xff);}}return new Uint8Array(out);}
function md5(input){const msg=u8(input);const S=[7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];const K=[];for(let i=0;i<64;i++)K[i]=Math.floor(Math.abs(Math.sin(i+1))*4294967296)>>>0;let a0=0x67452301,b0=0xefcdab89,c0=0x98badcfe,d0=0x10325476;const ml=msg.length,withOne=ml+1,total=withOne+((56-withOne%64+64)%64)+8,m=new Uint8Array(total);m.set(msg);m[ml]=0x80;const bitLen=ml*8,dv=new DataView(m.buffer);dv.setUint32(total-8,bitLen>>>0,true);dv.setUint32(total-4,Math.floor(bitLen/4294967296)>>>0,true);for(let off=0;off<total;off+=64){const M=[];for(let i=0;i<16;i++)M[i]=dv.getUint32(off+i*4,true);let A=a0,B=b0,C=c0,D=d0;for(let i=0;i<64;i++){let F,g;if(i<16){F=(B&C)|(~B&D);g=i;}else if(i<32){F=(D&B)|(~D&C);g=(5*i+1)%16;}else if(i<48){F=B^C^D;g=(3*i+5)%16;}else{F=C^(B|~D);g=(7*i)%16;}F=(F+A+K[i]+M[g])>>>0;A=D;D=C;C=B;const rot=(F<<S[i])|(F>>>(32-S[i]));B=(B+rot)>>>0;}a0=(a0+A)>>>0;b0=(b0+B)>>>0;c0=(c0+C)>>>0;d0=(d0+D)>>>0;}const out=new Uint8Array(16),o=new DataView(out.buffer);o.setUint32(0,a0,true);o.setUint32(4,b0,true);o.setUint32(8,c0,true);o.setUint32(12,d0,true);return out;}
const md5hex=x=>toHex(md5(x));
const ASB=(()=>{const s=new Uint8Array(256);let p=1,q=1;do{p=p^(p<<1)^((p&0x80)?0x11b:0);p&=0xff;q^=q<<1;q^=q<<2;q^=q<<4;q&=0xff;if(q&0x80)q^=0x09;const x=q^((q<<1)|(q>>>7))^((q<<2)|(q>>>6))^((q<<3)|(q>>>5))^((q<<4)|(q>>>4));s[p]=(x^0x63)&0xff;}while(p!==1);s[0]=0x63;return s;})();
const AISB=(()=>{const inv=new Uint8Array(256);for(let i=0;i<256;i++)inv[ASB[i]]=i;return inv;})();
function xt(a){return ((a<<1)^((a&0x80)?0x11b:0))&0xff;}
function mul(a,b){let r=0;for(let i=0;i<8;i++){if(b&1)r^=a;const hi=a&0x80;a=(a<<1)&0xff;if(hi)a^=0x1b;b>>=1;}return r&0xff;}
function expand128(key){const Nk=4,Nr=10,w=new Uint8Array(16*(Nr+1));w.set(key);const rcon=[0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36];let i=Nk;const t=new Uint8Array(4);while(i<4*(Nr+1)){for(let k=0;k<4;k++)t[k]=w[(i-1)*4+k];if(i%Nk===0){const tmp=t[0];t[0]=ASB[t[1]]^rcon[i/Nk-1];t[1]=ASB[t[2]];t[2]=ASB[t[3]];t[3]=ASB[tmp];}for(let k=0;k<4;k++)w[i*4+k]=w[(i-Nk)*4+k]^t[k];i++;}return {w,Nr};}
function encBlock(st,w,Nr){const s=st.slice();for(let k=0;k<16;k++)s[k]^=w[k];for(let r=1;r<Nr;r++){for(let k=0;k<16;k++)s[k]=ASB[s[k]];shiftRows(s);mixCols(s);for(let k=0;k<16;k++)s[k]^=w[r*16+k];}for(let k=0;k<16;k++)s[k]=ASB[s[k]];shiftRows(s);for(let k=0;k<16;k++)s[k]^=w[Nr*16+k];return s;}
function decBlock(st,w,Nr){const s=st.slice();for(let k=0;k<16;k++)s[k]^=w[Nr*16+k];for(let r=Nr-1;r>=1;r--){invShiftRows(s);for(let k=0;k<16;k++)s[k]=AISB[s[k]];for(let k=0;k<16;k++)s[k]^=w[r*16+k];invMixCols(s);}invShiftRows(s);for(let k=0;k<16;k++)s[k]=AISB[s[k]];for(let k=0;k<16;k++)s[k]^=w[k];return s;}
function shiftRows(s){const t=[s[0],s[5],s[10],s[15],s[4],s[9],s[14],s[3],s[8],s[13],s[2],s[7],s[12],s[1],s[6],s[11]];for(let i=0;i<16;i++)s[i]=t[i];}
function invShiftRows(s){const t=[s[0],s[13],s[10],s[7],s[4],s[1],s[14],s[11],s[8],s[5],s[2],s[15],s[12],s[9],s[6],s[3]];for(let i=0;i<16;i++)s[i]=t[i];}
function mixCols(s){for(let c=0;c<4;c++){const o=c*4,a0=s[o],a1=s[o+1],a2=s[o+2],a3=s[o+3];s[o]=xt(a0)^(xt(a1)^a1)^a2^a3;s[o+1]=a0^xt(a1)^(xt(a2)^a2)^a3;s[o+2]=a0^a1^xt(a2)^(xt(a3)^a3);s[o+3]=(xt(a0)^a0)^a1^a2^xt(a3);}}
function invMixCols(s){for(let c=0;c<4;c++){const o=c*4,a0=s[o],a1=s[o+1],a2=s[o+2],a3=s[o+3];s[o]=mul(a0,14)^mul(a1,11)^mul(a2,13)^mul(a3,9);s[o+1]=mul(a0,9)^mul(a1,14)^mul(a2,11)^mul(a3,13);s[o+2]=mul(a0,13)^mul(a1,9)^mul(a2,14)^mul(a3,11);s[o+3]=mul(a0,11)^mul(a1,13)^mul(a2,9)^mul(a3,14);}}
function aesCbcEnc(plainBytes,keyText,ivText){const {w,Nr}=expand128(u8(keyText)),iv=u8(ivText),pad=16-(plainBytes.length%16),buf=new Uint8Array(plainBytes.length+pad);buf.set(plainBytes);for(let i=plainBytes.length;i<buf.length;i++)buf[i]=pad;const out=new Uint8Array(buf.length);let prev=iv;for(let i=0;i<buf.length;i+=16){const blk=buf.subarray(i,i+16).slice();for(let k=0;k<16;k++)blk[k]^=prev[k];const ct=encBlock(blk,w,Nr);out.set(ct,i);prev=ct;}return out;}
function aesCbcDec(cipherBytes,keyText,ivText){const {w,Nr}=expand128(u8(keyText)),iv=u8(ivText),out=new Uint8Array(cipherBytes.length);let prev=iv;for(let i=0;i<cipherBytes.length;i+=16){const blk=cipherBytes.subarray(i,i+16),pt=decBlock(blk.slice(),w,Nr);for(let k=0;k<16;k++)pt[k]^=prev[k];out.set(pt,i);prev=blk;}const pad=out[out.length-1];return out.slice(0,out.length-(pad>0&&pad<=16?pad:0));}
const encB64=(plainStr,keyText,ivText)=>b64(aesCbcEnc(u8(plainStr),keyText,ivText));
const decStr=(b64str,keyText,ivText)=>u8s(aesCbcDec(b64dec(b64str),keyText,ivText));
function nonce8(){let s='';for(let i=0;i<8;i++)s+=Math.floor(Math.random()*10);return s;}

// 续登请求里的 cellNum: 每次按当前时间重新加密手机号 (重放旧值几天后失效), 同 paperclip cmcc.js r10
const RSA_N=BigInt("0x968e9acf9e59b4e2e1bb24266ee39043788a45f788ecdc5c971f4964c3267cf20afd3b7f029b68a9a9b65d77d0306b8319df0c174f3dd82ef3894a6c38e23634f6095a81901ad7e6650911c0910f12c7de50a6fcee3ae3563cc5985c46a965db2af49e94f69b62f67ff3d5c0f79782572375e5f8b44aa43c0ca6d48e8a969beb");
function modpow(b,e,m){let r=1n;b%=m;while(e>0n){if(e&1n)r=(r*b)%m;e>>=1n;b=(b*b)%m;}return r;}
function cellNumFor(tel){const d=new Date(),p=x=>String(x).padStart(2,'0');const m=u8('leadeon'+tel+d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+p(d.getHours())+p(d.getMinutes())+p(d.getSeconds()));const eb=[0,2];while(eb.length<128-m.length-1)eb.push(1+Math.floor(Math.random()*255));eb.push(0,...m);const h=modpow(BigInt('0x'+toHex(eb)),65537n,RSA_N).toString(16).padStart(256,'0');const o=new Uint8Array(128);for(let i=0;i<128;i++)o[i]=parseInt(h.substr(i*2,2),16);return b64(o);}

// ---------------- 抓取主逻辑 ----------------
var BOX_KEY = 'cmcc_login';
var LK = 'tVkdaRWRY0ZkV1Vr';
var LIV = 'VjFSQ1ZtVkQxRTlQ';

function tryEnvelope(text) {
  try {
    var j = JSON.parse(text);
    if (j && j.xk && j.tel) return JSON.stringify(j);
  } catch (e) {}
  return null;
}

function main() {
  var body = ($request && $request.body) || '';
  if (typeof body === 'string') body = body.trim();
  if (!body) { $done({}); return; }
  // 1) 请求体本身就是明文 JSON
  var env = tryEnvelope(body);
  // 2) 请求体是 AES 加密的 base64, 解密后再解析
  if (!env) {
    try { env = tryEnvelope(decStr(body, LK, LIV)); } catch (e) {}
  }
  if (env) {
    var old = '';
    try { old = $persistentStore.read(BOX_KEY) || ''; } catch (e) {}
    $persistentStore.write(env, BOX_KEY);
    var tel = '', oldTel = '';
    try { tel = JSON.parse(env).tel || ''; } catch (e) {}
    try { oldTel = old ? (JSON.parse(old).tel || '') : ''; } catch (e) {}
    // 首次抓到或换号时通知一次; 同号只换了 cellNum 的静默更新
    if (!old || oldTel !== tel) {
      $notification.post('移动登录凭证', '获取成功 ✅', '登录信封已保存到 BoxJS（cmcc_login），回小组件点「从 BoxJS 导入」。');
    }
    console.log('[cmcc_login 抓取] 已保存 tel=' + tel);
  } else {
    console.log('[cmcc_login 抓取] 请求体解析失败，未写入');
  }
  $done({});
}
main();
