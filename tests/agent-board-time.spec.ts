import {expect,it} from 'vitest'
import {boardTimestamp} from '../plugins/agent-board/time.ts'

it.each(['en','zh-CN'] as const)('distinguishes records on different days without expanding row labels (%s)',language=>{
  const first=boardTimestamp('2026-11-08T01:15:00Z',language),next=boardTimestamp('2026-11-09T01:15:00Z',language)
  expect(first.label).toBe(next.label)
  expect(first.title).not.toBe(next.title)
  expect(first.title).toContain('2026')
  expect(first.dateTime).toBe('2026-11-08T01:15:00.000Z')
  expect(boardTimestamp(Date.parse(first.dateTime!),language)).toEqual(first)
})
it('keeps invalid historical timestamps renderable without inventing a date',()=>{
  expect(boardTimestamp('invalid','en')).toEqual({label:'—',title:'Time unavailable',dateTime:undefined})
  expect(boardTimestamp(NaN,'zh-CN')).toEqual({label:'—',title:'时间不可用',dateTime:undefined})
})
