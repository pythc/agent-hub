/** Screencast image height may exclude browser chrome included in deviceHeight. */
export function browserPoint(
  client: {x:number;y:number},
  rect: {x:number;y:number;width:number;height:number},
  image: {width:number;height:number},
  deviceWidth:number,
) {
  if (![image.width,image.height,rect.width,rect.height,deviceWidth].every(v=>Number.isFinite(v)&&v>0)) return null
  const scale=Math.min(rect.width/image.width,rect.height/image.height)
  const x=(client.x-rect.x-(rect.width-image.width*scale)/2)/scale
  const y=(client.y-rect.y-(rect.height-image.height*scale)/2)/scale
  if(x<0||y<0||x>=image.width||y>=image.height)return null
  return {x:x*deviceWidth/image.width,y:y*deviceWidth/image.width}
}
