import {it,expect} from 'vitest'
import {browserPoint} from '../web/chat/browser-geometry.ts'

it('maps a letterboxed screencast to page coordinates using actual image dimensions',()=>{
  const point=browserPoint({x:1140.3421875,y:587.533056640625},{x:821,y:310,width:679,height:592},{width:1280,height:633},1280)
  expect(point?.x).toBeCloseTo(602);expect(point?.y).toBeCloseTo(281.6875)
})
it('scales compressed frames and rejects clicks outside the actual page',()=>{
  expect(browserPoint({x:150,y:100},{x:0,y:0,width:400,height:300},{width:800,height:600},1600)).toEqual({x:600,y:400})
  expect(browserPoint({x:10,y:10},{x:0,y:0,width:400,height:500},{width:800,height:400},800)).toBeNull()
  expect(browserPoint({x:0,y:0},{x:0,y:0,width:400,height:500},{width:0,height:0},800)).toBeNull()
})
