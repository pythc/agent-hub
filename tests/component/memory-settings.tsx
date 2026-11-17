import React from 'react';
import {createRoot} from 'react-dom/client';
import {MemorySettings} from '../../web/chat/memory.tsx';
import '../../src/ui/theme.css';
import '../../web/chat/style.css';
const calls:unknown[]=[],fact={id:'memory',revision:1,content:'任务仍在处理',subject:'Task note',sources:[],state:'active',visibility:'group',createdAt:0,kind:'fact',origin:'explicit',access:{mode:'origin'},taskRecord:{state:'completed',updatedAt:'2026-11-17T06:00:00Z',newerThanMemory:true}};
window.fetch=async(path,options)=>{
 const body=options?.body?JSON.parse(String(options.body)):undefined;
 if(path==='/router-management/catalog')return Response.json({contexts:[{id:'entry',entryId:'scope'}]});
 if(path==='/agent-memory')return Response.json({items:[fact]});
 if(path==='/router-memory'){calls.push(body);Object.assign(fact,{content:body.command.content,category:body.command.category,revision:fact.revision+1});return Response.json({});}
 throw Error('Unexpected fixture request');
};
Object.assign(window,{fixture:{calls}});
createRoot(document.getElementById('root')!).render(<MemorySettings L={(_en,zh)=>zh}/>);
