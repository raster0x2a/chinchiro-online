export type Role={name:string;rank:number;multiple:number};
export type Player={id:string;token:string;name:string;chips:number;bet:number;ready:boolean;dice:number[];rolls:number;done:boolean;delta:number};
export type Spectator=Pick<Player,'id'|'token'|'name'>&{chips?:number};
export type SettlementAccount=Pick<Player,'id'|'name'|'chips'>;
export const CHAT_REACTIONS=['👍','👎','❤️','😂','🔥','🎉'] as const;
export type ChatReaction={userId:string;emoji:string};
export type ChatMessage={id:string;senderId:string;name:string;text:string;sentAt:number;spectator:boolean;reactions?:ChatReaction[]};
export type Room={code:string;host:string;players:Player[];spectators?:Spectator[];departed?:SettlementAccount[];messages?:ChatMessage[];nextDealerId?:string;rerolls:number;initial:number;betLimit?:number|null;cycleRemaining?:string[];phase:'lobby'|'betting'|'rolling'|'result'|'settlement';settlementReason?:'negative'|'manual';cancelledRound?:boolean;dealer:number;turn:number;round:number;log:string[];updated:number};
export function judge(d:number[]):Role {
 const [a,b,c]=[...d].sort((x,y)=>x-y);
 if(a===b&&b===c)return a===1?{name:'ピンゾロ',rank:10,multiple:5}:{name:'ゾロ目',rank:9,multiple:3};
 if(a===4&&b===5&&c===6)return {name:'シゴロ',rank:8,multiple:2};
 if(a===1&&b===2&&c===3)return {name:'ヒフミ',rank:-1,multiple:2};
 const point=a===b?c:b===c?a:a===c?b:0;
 return {name:point?`${point}の目`:'役なし',rank:point,multiple:1};
}
export function rollDice(){return Array.from({length:3},()=>{let n=0;do{n=crypto.getRandomValues(new Uint32Array(1))[0]}while(n>=4294967292);return n%6+1})}
export function validBetLimit(value:unknown){return value==null||(typeof value==='number'&&Number.isSafeInteger(value)&&value>=1)}
export function maxBet(r:Room,p:Player){return Math.max(0,Math.min(Math.floor(p.chips),r.betLimit??Infinity))}
export function remainingDealers(r:Room){return r.cycleRemaining??(r.round===0?[]:r.players.slice(r.dealer+(r.phase==='result'?1:0)).map(p=>p.id))}
export function cycleLocked(r:Room){return remainingDealers(r).length>0}
export function nextDealerIndex(r:Room){const next=remainingDealers(r)[0]??r.nextDealerId;const index=r.players.findIndex(p=>p.id===next);return index>=0?index:(r.dealer+1)%r.players.length}
export function canBetAgainstDealer(r:Room,dealer=r.dealer){return r.players.some((p,i)=>i!==dealer&&p.chips>=1)}
export function prepare(r:Room){delete r.nextDealerId;if(!cycleLocked(r))r.cycleRemaining=[...r.players.slice(r.dealer),...r.players.slice(0,r.dealer)].map(p=>p.id);else r.cycleRemaining=remainingDealers(r);r.phase='betting';r.turn=r.dealer;r.round++;for(const [i,p] of r.players.entries()){const resting=i!==r.dealer&&p.chips<=0;p.bet=0;p.ready=i===r.dealer||resting;p.dice=[];p.rolls=0;p.done=resting;p.delta=0;}r.updated=Date.now()}
export function settle(r:Room){const dealer=r.players[r.dealer],dr=judge(dealer.dice);r.log=[];for(const p of r.players){if(p===dealer)continue;if(p.bet===0){p.delta=0;r.log.push(`${p.name}：見学`);continue;}const pr=judge(p.dice);const sign=Math.sign(pr.rank-dr.rank);const multiplier=Math.max(sign>0?pr.multiple:dr.multiple,sign>0&&dr.rank===-1?2:sign<0&&pr.rank===-1?2:1);p.delta=sign*p.bet*multiplier;p.chips+=p.delta;dealer.delta-=p.delta;r.log.push(`${p.name}：${p.delta>0?'+':''}${p.delta.toLocaleString()} チップ`)}dealer.chips+=dealer.delta;r.cycleRemaining=remainingDealers(r).filter(id=>id!==dealer.id);r.phase='result';if(r.players.some(p=>p.chips<=0))enterSettlement(r,'negative')}
export function advance(r:Room){if(r.players.every(p=>p.done)){settle(r);return}do{r.turn=(r.turn+1)%r.players.length}while(r.players[r.turn].done);r.updated=Date.now()}

export function enterSettlement(r:Room,reason:'negative'|'manual'){
 r.cancelledRound=r.phase==='betting'||r.phase==='rolling';
 if(r.cancelledRound)for(const p of r.players){p.dice=[];p.bet=0;p.delta=0;p.rolls=0;p.done=false;p.ready=false}
 r.phase='settlement';r.settlementReason=reason;r.updated=Date.now();
}
export function settlementParticipants(r:Room):SettlementAccount[]{return [...r.players,...(r.spectators??[]).filter((p):p is Spectator&{chips:number}=>typeof p.chips==='number'),...(r.departed??[])]}
export function moveToSpectator(r:Room,id:string){
 if(cycleLocked(r)||!['lobby','result'].includes(r.phase))throw Error('親一周の終了後に観戦へ移動できます');
 if(r.players.length<=1)throw Error('最後のプレイヤーは観戦へ移動できません');
 const target=r.players.find(p=>p.id===id);if(!target)throw Error('プレイヤーが見つかりません');
 const start=r.phase==='result'?nextDealerIndex(r):r.dealer;
 const next=[...r.players.slice(start),...r.players.slice(0,start)].find(p=>p.id!==id)!;
 r.spectators??=[];r.spectators.push({id:target.id,token:target.token,name:target.name,chips:target.chips});
 r.players=r.players.filter(p=>p.id!==id);if(r.host===id)r.host=next.id;
 r.dealer=r.players.findIndex(p=>p.id===next.id);r.turn=r.dealer;r.phase='lobby';r.cycleRemaining=[];delete r.nextDealerId;
 for(const p of r.players){p.dice=[];p.bet=0;p.ready=false;p.done=false;p.rolls=0;p.delta=0}r.log=[];r.updated=Date.now();
}
export function settlementTransfers(r:Room){
 const participants=settlementParticipants(r);
 const debtors=participants.map(p=>({id:p.id,amount:r.initial-p.chips})).filter(p=>p.amount>0).sort((a,b)=>b.amount-a.amount);
 const creditors=participants.map(p=>({id:p.id,amount:p.chips-r.initial})).filter(p=>p.amount>0).sort((a,b)=>b.amount-a.amount);
 const transfers:{from:string;to:string;amount:number}[]=[];let i=0,j=0;
 while(i<debtors.length&&j<creditors.length){const amount=Math.min(debtors[i].amount,creditors[j].amount);transfers.push({from:debtors[i].id,to:creditors[j].id,amount});debtors[i].amount-=amount;creditors[j].amount-=amount;if(debtors[i].amount===0)i++;if(creditors[j].amount===0)j++}
 return {transfers,imbalance:participants.reduce((s,p)=>s+p.chips-r.initial,0)};
}
export function restart(r:Room){r.departed=[];for(const p of r.spectators??[])if(p.chips!==undefined)p.chips=r.initial;for(const p of r.players){p.chips=r.initial;p.bet=0;p.ready=false;p.dice=[];p.rolls=0;p.done=false;p.delta=0}delete r.nextDealerId;r.phase='lobby';r.round=0;r.dealer=0;r.turn=0;r.cycleRemaining=[];r.log=[];delete r.settlementReason;delete r.cancelledRound;}
