// Native DOM adaptation of affectUI's MIT Button and Segmented Control.
// Original CSS and source hashes: src/vendor/affectui/{LICENSE,provenance.json}.
function affectButton(text,callback,{variant='secondary',glyph,loading=false,disabled=false}={}){
 const button=el('button','ui-button');button.type='button';button.dataset.variant=variant;button.dataset.size='md';button.disabled=disabled
 if(loading){button.dataset.loading='true';button.setAttribute('aria-busy','true');button.setAttribute('aria-disabled','true')}
 if(glyph){const mark=add(el('span','ui-button__icon'),icon(glyph));mark.setAttribute('aria-hidden','true');button.append(mark)}
 const label=el('span','ui-button__label',text);label.dataset.text=text;button.append(label)
 button.onclick=event=>{if(loading){event.preventDefault();return}callback?.(event)}
 return button
}
function affectSegmented({id,label,options,value,onChange}){
 const root=el('div','ui-seg');root.dataset.size='lg';root.dataset.variant='tray'
 const select=value=>{root.selectValue(value);onChange(value);queueMicrotask(()=>document.getElementById(id+'-'+value)?.focus())}
 const track=el('div','ui-seg__track');track.setAttribute('role','tablist');track.setAttribute('aria-label',label)
 const pill=el('span','ui-seg__pill');pill.setAttribute('aria-hidden','true');track.append(pill)
 const buttons=options.map(option=>{
  const selected=option.value===value,button=el('button','ui-seg__opt');button.type='button';button.id=id+'-'+option.value
  button.setAttribute('role','tab');button.setAttribute('aria-selected',String(selected));button.setAttribute('aria-controls',option.controls);button.tabIndex=selected?0:-1
  button.dataset.value=option.value
  if(selected)button.dataset.active='true'
  const copy=el('span','ui-seg__text ui-seg__text-bold',option.label);copy.setAttribute('aria-hidden','true')
  button.append(add(el('span','ui-seg__content'),add(el('span','ui-seg__label'),el('span','ui-seg__text',option.label),copy)))
  button.onclick=()=>select(option.value);track.append(button);return button
 })
 track.onkeydown=event=>{
  const current=buttons.indexOf(document.activeElement);if(current<0)return
  const index=event.key==='Home'?0:event.key==='End'?buttons.length-1:event.key==='ArrowRight'?(current+1)%buttons.length:event.key==='ArrowLeft'?(current+buttons.length-1)%buttons.length:-1
  if(index<0)return;event.preventDefault();select(options[index].value)
 }
 root.append(add(el('div','ui-seg__scroller'),track))
 root.selectValue=value=>{for(const button of buttons){const selected=button.dataset.value===value;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;if(selected)button.dataset.active='true';else delete button.dataset.active}const selected=buttons.find(b=>b.dataset.active);if(!selected)return;pill.style.left=selected.offsetLeft+'px';pill.style.right=(track.clientWidth-selected.offsetLeft-selected.offsetWidth)+'px';pill.style.opacity='1'}
 queueMicrotask(()=>{if(root.isConnected)root.selectValue(value)})
 return root
}
