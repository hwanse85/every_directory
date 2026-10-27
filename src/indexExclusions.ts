export function normalizeExclusions(value:unknown):string[]{
  if(!Array.isArray(value)||value.length>128||value.some(rule=>typeof rule!=="string"))throw new Error("제외 폴더는 최대 128개까지 지정할 수 있습니다.");
  const rules=(value as string[]).map(rule=>rule.trim().replaceAll("\\","/").replace(/\/+$/,''));
  if(rules.some(rule=>!rule||rule.length>32760||rule.includes(':')||rule.startsWith('/')||rule.split('/').some(part=>!part||part==="."||part==="..")))throw new Error("연결 폴더 안의 상대 폴더 경로를 입력하세요. 상위 경로(..)는 사용할 수 없습니다.");
  return [...new Set(rules)];
}
export function isIndexExcluded(rules:string[]|undefined,relative:string,insensitive=false):boolean{
  const candidate=insensitive?relative.toLowerCase():relative;
  return (rules??[]).some(rule=>{const key=insensitive?rule.toLowerCase():rule;return candidate===key||candidate.startsWith(key+'/');});
}
