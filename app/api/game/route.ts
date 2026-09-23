import {env} from 'cloudflare:workers';
import {Room,Player,Spectator,CHAT_REACTIONS,judge,rollDice,maxBet,prepare,advance,canBetAgainstDealer,validBetLimit,cycleLocked,remainingDealers,nextDealerIndex,enterSettlement,restart,moveToSpectator} from '@/lib/game';
export const dynamic='force-dynamic';
const fail=(s:string,n=400)=>Response.json({error:s},{status:n});
const view=(r:Room)=>({...r,players:r.players.map(({token,...p})=>p),spectators:(r.spectators??[]).map(({token,...p})=>p)});
function nameOf(x:unknown){if(typeof x!=='string'||!x.trim()||x.trim().length>16)throw Error('名前は1〜16文字で入力してください');return x.trim()}
function player(name:string,initial:number):Player{return {id:crypto.randomUUID(),token:crypto.randomUUID(),name,chips:initial,bet:0,ready:false,dice:[],rolls:0,done:false,delta:0}}
export async function GET(req:Request){const u=new URL(req.url),code=u.searchParams.get('code')||'';const row=await env.DB!.prepare('SELECT state FROM rooms WHERE code=? AND expires>?').bind(code,Date.now()).first<{state:string}>();if(!row)return fail('ルームが見つかりません（有効期限24時間）',404);const r:Room=JSON.parse(row.state);if(![...r.players,...(r.spectators??[])].some(p=>p.token===req.headers.get('authorization')?.replace('Bearer ','')))return fail('ルームに参加してください',401);return Response.json({room:view(r)},{headers:{'Cache-Control':'no-store'}})}
export async function POST(req:Request){try{
 const b=await req.json() as {action:string;messageId?:string;emoji?:unknown;text?:unknown;name:unknown;rerolls:number;initial:number;betLimit?:number|null;code:string;bet:number;id:string};const action=b.action;const now=Date.now();
 if(action==='create'){
 const name=nameOf(b.name);if(!validBetLimit(b.betLimit))return fail('賭け上限は1以上の整数、または上限なしにしてください');if(!Number.isInteger(b.rerolls)||b.rerolls<0||b.rerolls>5||![1000,3000,10000].includes(b.initial))return fail('設定が正しくありません');
 const p=player(name,b.initial);const code=crypto.randomUUID().replaceAll('-','').slice(0,8).toUpperCase();const r:Room={code,host:p.id,players:[p],rerolls:b.rerolls,initial:b.initial,betLimit:b.betLimit??null,phase:'lobby',dealer:0,turn:0,round:0,log:[],updated:now};
 await env.DB!.prepare('INSERT INTO rooms(code,state,version,expires) VALUES(?,?,0,?)').bind(code,JSON.stringify(r),now+86400000).run();return Response.json({room:view(r),token:p.token,me:p.id});
 }
 const row=await env.DB!.prepare('SELECT state,version FROM rooms WHERE code=? AND expires>?').bind(String(b.code),now).first<{state:string;version:number}>();if(!row)return fail('ルームが見つかりません',404);const r:Room=JSON.parse(row.state);r.cycleRemaining=remainingDealers(r);let me=r.players.find(p=>p.token===req.headers.get('authorization')?.replace('Bearer ',''));const spectator=(r.spectators??=[]).find(p=>p.token===req.headers.get('authorization')?.replace('Bearer ',''));let joined:Player|Spectator|undefined;
 if(action==='join'){
 const name=nameOf(b.name);if([...r.players,...r.spectators!,...(r.departed??[])].some(p=>p.name===name))return fail('別の名前で参加してください');
 const p=player(name,r.initial);
 if(cycleLocked(r)||r.phase!=='lobby'||r.players.length>=8){joined={id:p.id,token:p.token,name:p.name};r.spectators!.push(joined)}else{joined=p;r.players.push(p);if(!r.host)r.host=p.id}
 }
 else if(action==='react'){
 const sender=me??spectator;if(!sender)return fail('ルームに参加してください',401);
 if(typeof b.emoji!=='string'||!CHAT_REACTIONS.some(emoji=>emoji===b.emoji))return fail('選択できないリアクションです');
 const message=r.messages?.find(m=>m.id===b.messageId);if(!message)return fail('メッセージが見つかりません',404);
 const reactions=message.reactions??[];const own=reactions.findIndex(item=>item.userId===sender.id&&item.emoji===b.emoji);
 if(own>=0)message.reactions=reactions.filter((_,i)=>i!==own);
 else{if(reactions.length>=5)return fail('リアクションは1メッセージにつき合計5個までです');message.reactions=[...reactions,{userId:sender.id,emoji:b.emoji}];}
 }
 else if(action==='chat'){
 const sender=me??spectator;if(!sender)return fail('ルームに参加してください',401);
 if(typeof b.text!=='string'||!b.text.trim()||b.text.trim().length>300)return fail('メッセージは1〜300文字で入力してください');
 const messages=r.messages??[];const last=[...messages].reverse().find(m=>m.senderId===sender.id);
 if(last&&now-last.sentAt<1000)return fail('少し待ってから送信してください',429);
 r.messages=[...messages,{id:crypto.randomUUID(),senderId:sender.id,name:sender.name,text:b.text.trim(),sentAt:now,spectator:!!spectator}].slice(-100);
 }
 else if(spectator){
 if(action==='leave'){if(spectator.chips!==undefined&&spectator.chips!==r.initial){r.departed??=[];r.departed.push({id:spectator.id,name:spectator.name,chips:spectator.chips})}r.spectators=r.spectators!.filter(p=>p.id!==spectator.id);}
 else if(action==='take_seat'){
 if(cycleLocked(r)||!['lobby','result'].includes(r.phase))return fail('親一周の終了後にプレイヤー参加できます');
 if(r.players.length>=8)return fail('満席です。空席ができるまで観戦できます');
 if(r.phase==='result')r.nextDealerId=r.players[nextDealerIndex(r)]?.id;
 r.players.push({...player(spectator.name,r.initial),...spectator,chips:spectator.chips??r.initial});r.spectators=r.spectators!.filter(p=>p.id!==spectator.id);if(!r.host)r.host=spectator.id;
 }else return fail('観戦中は対戦を操作できません',403);
 }
 else{
 if(!me)return fail('参加情報が見つかりません',401);const host=me.id===r.host;
 if(action==='settlement'){if(!host||r.phase==='settlement')return fail('ホストが清算へ進めます');enterSettlement(r,'manual')}
 else if(action==='restart'){if(!host||r.phase!=='settlement')return fail('清算後にホストが新しい対戦を始められます');restart(r)}
 else if(action==='start'){if(!host||r.phase!=='lobby'||r.players.length<2)return fail('2人以上でホストが開始できます');if(!canBetAgainstDealer(r))return fail('賭けられる子がいません。清算して新しい対戦を始めてください');prepare(r)}
 else if(action==='bet'){if(r.phase!=='betting'||me.ready)return fail('いまは賭けられません');if(!Number.isInteger(b.bet)||b.bet<1||b.bet>maxBet(r,me))return fail('賭けチップが範囲外です');me.bet=b.bet;me.ready=true;if(r.players.every(p=>p.ready)){r.phase='rolling';r.updated=now}}
 else if(action==='roll'){if(r.phase!=='rolling'||r.players[r.turn].id!==me.id||me.done)return fail('あなたの番ではありません');me.dice=rollDice();me.rolls++;if(judge(me.dice).rank!==0||me.rolls>r.rerolls){me.done=true;advance(r)}}
 else if(action==='hold'){if(r.phase!=='rolling'||r.players[r.turn].id!==me.id||!me.rolls||me.done)return fail('まだ確定できません');me.done=true;advance(r)}
 else if(action==='next'){if(!host||r.phase!=='result')return fail('ホストが次の局へ進めます');const nextDealer=nextDealerIndex(r);if(!canBetAgainstDealer(r,nextDealer))return fail('次の局で賭けられる子がいません。清算して新しい対戦を始めてください');r.dealer=nextDealer;prepare(r)}
 else if(action==='lobby'){if(r.phase==='settlement')return fail('清算後は新しい対戦を始めてください');if(!host)return fail('ホストだけが操作できます');if(r.phase==='result')r.dealer=nextDealerIndex(r);r.phase='lobby';for(const p of r.players){p.dice=[];p.bet=0;p.ready=false;p.delta=0;}r.log=[]}
 else if(action==='settings'){if(!host||!['lobby','result'].includes(r.phase)||cycleLocked(r))return fail('賭け上限は最初か親一周の終了後にだけ変更できます');if(!validBetLimit(b.betLimit))return fail('賭け上限は1以上の整数、または上限なしにしてください');r.betLimit=b.betLimit??null;}
 else if(action==='reset'){return fail('清算画面から新しい対戦を始めてください')}
 else if(action==='spectate'||action==='remove'){
 const target=b.id??me.id;if(target!==me.id&&!host)return fail('ほかの人を観戦へ移せるのはホストだけです',403);
 try{moveToSpectator(r,target)}catch(e){return fail(e instanceof Error?e.message:'観戦へ移動できません')}
 }
 else if(action==='leave'){if(r.phase!=='lobby'||cycleLocked(r))return fail('親一周の終了後、待合室で退出できます');if(me.chips!==r.initial)return fail('チップの増減があるため、先に清算してください');r.players=r.players.filter(p=>p.id!==me!.id);if(host)r.host=r.players[0]?.id||'';r.dealer=0}
 else return fail('不明な操作です');
 }
 const result=await env.DB!.prepare('UPDATE rooms SET state=?,version=version+1 WHERE code=? AND version=?').bind(JSON.stringify(r),r.code,row.version).run();if(!result.meta.changes)return fail('同時に操作がありました。もう一度お試しください',409);
 return Response.json({room:view(r),...(joined?{token:joined.token,me:joined.id}:{})});
 }catch(e){console.error(e);return fail(e instanceof Error&&e.message.startsWith('名前は')?e.message:'処理できませんでした。少し待って再試行してください',500)}}
