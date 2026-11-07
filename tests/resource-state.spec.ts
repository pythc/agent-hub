import { describe, expect, it } from 'vitest';
import { initialResources, openResource, closeResource, resourceUrl } from '../web/chat/resource-state.ts';
describe('conversation resource tabs',()=>{
  it('migrates an existing resource choice and respects a closed panel',()=>{
    const old=initialResources('', 'browser');
    expect(old.visible).toBe(true);expect(old.tabs.find(t=>t.id===old.active)?.kind).toBe('browser');
    expect(initialResources('', 'closed').visible).toBe(false);
  });
  it('restores opened tabs and recent tools without duplicating the same tool',()=>{
    let s=initialResources('');s=openResource(s,'files',10);const file=s.active;
    s=openResource(s,'browser',20);s=openResource(s,'files',30);
    const restored=initialResources(JSON.stringify(s));
    expect(restored.active).toBe(file);expect(restored.tabs.map(t=>t.kind)).toEqual(['new','files','browser']);
    expect(restored.recent).toEqual([{kind:'files',at:30},{kind:'browser',at:20}]);
  });
  it('closing a view preserves its recent record and chooses an adjacent tab',()=>{
    let s=openResource(initialResources(''),'files',1);const file=s.active;s=openResource(s,'activity',2);
    s=closeResource(s,s.active);expect(s.active).toBe(file);expect(s.recent[0]?.kind).toBe('activity');
    for(const t of [...s.tabs]) s=closeResource(s,t.id);
    expect(s.tabs).toHaveLength(1);expect(s.tabs[0]?.kind).toBe('new');expect(s.visible).toBe(true);
  });
  it('rejects malformed saved tabs and removes invalid recent timestamps',()=>{
    for(const tabs of [[{kind:'files'}],[{id:'x',kind:'files'},{id:'x',kind:'browser'}],[{id:'x',kind:'bad'}]]){
      expect(initialResources(JSON.stringify({tabs,active:'x',visible:true})).visible).toBe(false);
    }
    const s=initialResources('');
    expect(initialResources(JSON.stringify({...s,recent:[{kind:'files',at:1e30}]})).recent).toEqual([]);
  });
  it('normalizes web addresses while rejecting credentials and executable schemes',()=>{
    expect(resourceUrl('example.com/path')).toBe('https://example.com/path');
    expect(resourceUrl('127.0.0.1:61566/login')).toBe('http://127.0.0.1:61566/login');
    expect(resourceUrl('https://example.com/?q=hello')).toBe('https://example.com/?q=hello');
    for(const value of ['Files','团队动态','javascript:alert(1)','file:///tmp/x','https://user:password@example.com','hello world','data:text/html,a']) expect(resourceUrl(value)).toBeNull();
  });
});
