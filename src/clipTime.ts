const timeFormat=new Intl.DateTimeFormat("ko-KR",{hour:"numeric",minute:"2-digit"});
const dateFormat=new Intl.DateTimeFormat("ko-KR",{month:"long",day:"numeric",hour:"numeric",minute:"2-digit"});
// 복사 시각을 ‘방금·n분 전·오늘·어제’처럼 짧게 표시한다.
export function clipTime(createdAt:number,now=Date.now()):string{
 const minutes=Math.floor((now-createdAt)/60000);
 if(minutes<1)return "방금";if(minutes<60)return `${minutes}분 전`;
 const today=new Date(now);today.setHours(0,0,0,0);
 if(createdAt>=today.getTime())return `오늘 ${timeFormat.format(createdAt)}`;
 if(createdAt>=today.getTime()-86400000)return `어제 ${timeFormat.format(createdAt)}`;
 return dateFormat.format(createdAt);
}
