/* Frame-local browser automation. The bridge returns data only; native owns every capability. */
(function () {
  'use strict';
  var args = __ARGS__;
  if (!window.__newsNookAgentExecute) {
    var cap = 120;
    var selector = 'a[href],button,input,textarea,select,summary,[role="button"],[role="textbox"],[role="link"],[role="checkbox"],[role="radio"],[role="tab"],[role="option"],[contenteditable],[tabindex]';
    var closedRoots = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
    var rootsObserved = [];
    var revision = 0;
    var serial = 0;
    var frameId = 'frame-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    var documentId = frameId + '-document';
    Object.defineProperty(window,'__newsNookAgentDocumentId',{value:documentId,configurable:false});
    Object.defineProperty(window,'__newsNookAgentFrameId',{value:frameId,configurable:false});
    var cancelled = Object.create(null);
    var bridgeInstalled = false;
    var observer = typeof MutationObserver !== 'undefined' ? new MutationObserver(function () { revision++; }) : null;

    function observeRoot(root) {
      if (!observer || rootsObserved.indexOf(root) !== -1) return;
      try { observer.observe(root, {subtree:true,childList:true,attributes:true,characterData:true}); rootsObserved.push(root); } catch {}
    }
    observeRoot(document);
    // Preserve mode and semantics. Only roots created after this hook can be captured.
    if (typeof Element !== 'undefined' && Element.prototype.attachShadow && closedRoots) {
      var attach = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function () {
        var root = attach.apply(this, arguments);
        closedRoots.set(this, root);
        observeRoot(root);
        return root;
      };
    }
    function flushMutations() {
      if (observer && observer.takeRecords().length) revision++;
    }
    function style(el) {
      var owner = el.ownerDocument && el.ownerDocument.defaultView;
      return owner && owner.getComputedStyle ? owner.getComputedStyle(el) : getComputedStyle(el);
    }
    function parent(el) {
      if (el.parentElement) return el.parentElement;
      var root = el.getRootNode && el.getRootNode();
      return root && root.host || null;
    }
    function visible(el) {
      if (!el || typeof el.getBoundingClientRect !== 'function') return false;
      var r = el.getBoundingClientRect(), current = el;
      if (!(r.width > 0 && r.height > 0)) return false;
      while (current && current.nodeType !== 9) {
        var s = style(current);
        if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse' || s.opacity === '0' ||
            current.hidden || current.hasAttribute && current.hasAttribute('inert')) return false;
        current = parent(current);
      }
      return true;
    }
    function rect(el) {
      var r = el.getBoundingClientRect();
      return {x:r.left == null ? r.x : r.left,y:r.top == null ? r.y : r.top,width:r.width,height:r.height,
        right:r.right == null ? r.x+r.width : r.right,bottom:r.bottom == null ? r.y+r.height : r.bottom};
    }
    function viewport() {
      var v = window.visualViewport;
      return {width:innerWidth,height:innerHeight,offsetLeft:v ? v.offsetLeft : 0,offsetTop:v ? v.offsetTop : 0,scale:v ? v.scale : 1};
    }
    function protectedInput(el) {
      var type = (el.getAttribute('type') || '').toLowerCase();
      var autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
      return type === 'password' || /(?:current-password|new-password|one-time-code|cc-number|cc-csc)/.test(autocomplete);
    }
    function label(el) {
      if (protectedInput(el)) return '[受保护的输入框]';
      var value = el.getAttribute('aria-label');
      var refs = el.getAttribute('aria-labelledby');
      if (!value && refs && el.ownerDocument) value = refs.split(/\s+/).map(function (id) {
        var root=el.getRootNode ? el.getRootNode() : el.ownerDocument;
        var node = root.getElementById ? root.getElementById(id) : el.ownerDocument.getElementById(id); return node ? node.textContent : '';
      }).join(' ');
      if (!value && el.labels && el.labels.length) value = Array.prototype.map.call(el.labels,function (node) {return node.textContent;}).join(' ');
      return String(value || el.getAttribute('placeholder') || el.innerText || el.textContent || el.getAttribute('title') || el.getAttribute('alt') || '')
        .trim().replace(/\s+/g,' ').slice(0,180);
    }
    function disabled(el) {
      return !!(el.disabled || el.hasAttribute && el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true' ||
        el.closest && el.closest('fieldset[disabled]'));
    }
    function fingerprint(el) {
      return [el.tagName,label(el),el.getAttribute('type'),el.getAttribute('href'),el.getAttribute('role'),
        el.getAttribute('name'),el.form && el.form.getAttribute('action'),disabled(el),el.readOnly].join('|');
    }
    function collect() {
      var found = [], roots = [], scanned = 0;
      function walk(root) {
        if (!root || roots.indexOf(root) !== -1 || scanned > 8000) return;
        roots.push(root); observeRoot(root);
        var candidates = root.querySelectorAll ? root.querySelectorAll(selector) : [];
        Array.prototype.forEach.call(candidates, function (el) {
          if (found.indexOf(el) === -1 && visible(el)) found.push(el);
        });
        var all = root.querySelectorAll ? root.querySelectorAll('*') : [];
        for (var i=0;i<all.length && scanned++<8000;i++) {
          var child = all[i];
          var shadow = child.shadowRoot || closedRoots && closedRoots.get(child);
          if (shadow) walk(shadow);
          if (visible(child) && child.scrollHeight > child.clientHeight + 40 && /(auto|scroll)/.test(style(child).overflowY) &&
              found.indexOf(child) === -1) found.push(child);
        }
      }
      walk(document);
      function priority(el) {
        var r = rect(el);
        if (r.bottom >= 0 && r.y <= innerHeight && r.right >= 0 && r.x <= innerWidth) return 0;
        return Math.max(0,r.y-innerHeight,-r.bottom,r.x-innerWidth,-r.right);
      }
      found = found.map(function (node,index) {return {node:node,index:index,priority:priority(node)};})
        .sort(function (a,b) {return a.priority-b.priority || a.index-b.index;})
        .slice(0,cap).map(function (entry) {return entry.node;});
      return {nodes:found,roots:roots};
    }
    function readText(roots) {
      var collected = [], length = 0, count = 0;
      if (!document.createTreeWalker || !document.createRange || typeof NodeFilter === 'undefined') return (document.body && document.body.innerText || '').slice(0,12000);
      for(var i=0;i<roots.length && length<12000;i++) {
        var walker = document.createTreeWalker(roots[i],NodeFilter.SHOW_TEXT), node;
        while((node=walker.nextNode()) && count++<8000 && length<12000) {
          var text = (node.textContent || '').replace(/\s+/g,' ').trim();
          var el = node.parentElement;
          if (!text || !el || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA)$/.test(el.tagName) || !visible(el) || protectedInput(el)) continue;
          var range = document.createRange(); range.selectNodeContents(node);
          var r = range.getBoundingClientRect();
          if (!(r.width>0 && r.height>0) || r.bottom<0 || r.top>innerHeight || r.right<0 || r.left>innerWidth) continue;
          var item=text.slice(0,1200); collected.push(item); length+=item.length+1;
        }
      }
      return collected.join('\n').slice(0,12000);
    }
    function error(message, code) {return {error:message,code:code || 'ACTION_REJECTED',dispatched:false};}
    function stateFor(action) {
      var state = window.__newsNookAgentSnapshot;
      if (!state || !action.snapshot || state.snapshot !== action.snapshot || state.document !== document || state.url !== location.href)
        return null;
      return state;
    }
    function targetFor(action,state) {
      if (!Number.isInteger(action.id) || action.id<0) return null;
      return state.nodes[action.id];
    }
    function unobscured(el) {
      var r=rect(el), x=Math.max(0,Math.min(innerWidth-1,r.x+r.width/2)), y=Math.max(0,Math.min(innerHeight-1,r.y+r.height/2));
      if (r.bottom<=0 || r.y>=innerHeight || r.right<=0 || r.x>=innerWidth) return false;
      if (style(el).pointerEvents==='none') return false;
      if (!document.elementFromPoint) return true;
      var hit=document.elementFromPoint(x,y), limit=0;
      if (!hit) return true;
      while(hit && limit++<20) {
        if (hit===el || el.contains && el.contains(hit)) return true;
        var root=hit.shadowRoot || closedRoots && closedRoots.get(hit);
        var deeper=root && root.elementFromPoint && root.elementFromPoint(x,y);
        if(!deeper || deeper===hit) break;
        hit=deeper;
      }
      // A closed root may only expose its host to hit testing.
      for(var current=el;current;current=parent(current)) if(current===hit) return true;
      return false;
    }
    function dispatch(el,name,options) {
      var view=el.ownerDocument && el.ownerDocument.defaultView;
      var EventClass=view && view.Event || Event;
      return el.dispatchEvent(new EventClass(name,Object.assign({bubbles:true,composed:true},options || {})));
    }
    function inputEvent(el,name,value,cancelable) {
      var owner=el.ownerDocument && el.ownerDocument.defaultView;
      if(owner && typeof owner.InputEvent==='function')
        return el.dispatchEvent(new owner.InputEvent(name,{bubbles:true,composed:true,cancelable:!!cancelable,inputType:'insertReplacementText',data:value}));
      return dispatch(el,name,{cancelable:!!cancelable});
    }
    function execute(action) {
      var didDispatch=false;
      try {
        if(action.action==='bootstrap') {installBridge(); return {ok:true,frameId:frameId,documentId:documentId};}
        if(action.action==='observe') {
          flushMutations();
          var collected=collect(), nodes=collected.nodes;
          var snapshot=frameId+'-'+(++serial)+'-'+Date.now();
          window.__newsNookAgentSnapshot={snapshot:snapshot,url:location.href,document:document,nodes:nodes,
            fingerprints:nodes.map(fingerprint),revision:revision,scrollX:typeof scrollX==='number'?scrollX:0,
            scrollY:typeof scrollY==='number'?scrollY:0,viewport:viewport()};
          var items=nodes.map(function(el,i) {
            var r=rect(el), tag=el.tagName.toLowerCase();
            return {id:i,tag:tag,role:el.getAttribute('role') || '',text:label(el),type:el.getAttribute('type') || (el.form && el.type) || '',
              href:el.getAttribute('href') || '',x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),
              bounds:r,disabled:disabled(el),readOnly:!!el.readOnly,protected:protectedInput(el),
              accept:tag==='input' && el.type==='file' ? el.getAttribute('accept') || '' : undefined,
              multiple:tag==='input' && el.type==='file' ? !!el.multiple : undefined,
              value:!protectedInput(el) && !/^(file|hidden)$/i.test(el.type || '') && typeof el.value==='string' ? el.value.slice(0,2000) : undefined,
              checked:typeof el.checked==='boolean' ? el.checked : el.hasAttribute('aria-checked') ? el.getAttribute('aria-checked')==='true' : undefined,
              expanded:el.hasAttribute('aria-expanded') ? el.getAttribute('aria-expanded')==='true' : undefined,
              selected:el.hasAttribute('aria-selected') ? el.getAttribute('aria-selected')==='true' : undefined,
              scrollable:el.scrollHeight>el.clientHeight+40,
              options:tag==='select' ? Array.prototype.map.call(el.options,function(o){return {value:o.value,label:o.text || o.textContent,disabled:!!o.disabled};}).slice(0,80) : undefined};
          });
          return {snapshot:snapshot,frameId:frameId,documentId:documentId,url:location.href,title:document.title,
            viewport:viewport(),scrollY:typeof scrollY==='number'?scrollY:0,documentHeight:document.documentElement && document.documentElement.scrollHeight || 0,
            text:readText(collected.roots),elements:items,capabilities:{openShadowDom:true,capturedClosedShadowDom:!!closedRoots,elementLimit:cap}};
        }
        var state=stateFor(action);
        if(!state) return error('页面状态已变化，请重新观察网页','STALE_SNAPSHOT');
        if(action.action==='validate_snapshot' || action.action==='validate') {
          flushMutations();
          var v=viewport(), before=state.viewport;
          if(revision!==state.revision || state.scrollX!==(typeof scrollX==='number'?scrollX:0) || state.scrollY!==(typeof scrollY==='number'?scrollY:0) ||
            v.width!==before.width || v.height!==before.height || v.offsetLeft!==before.offsetLeft || v.offsetTop!==before.offsetTop || v.scale!==before.scale)
            return error('页面画面已变化，请重新截图','STALE_SCREENSHOT');
          return {ok:true};
        }
        if(action.action==='scroll') {
          var direction=action.direction || 'down';
          if(['up','down','left','right'].indexOf(direction)<0) return error('无效滚动方向');
          var horizontal=direction==='left'||direction==='right';
          var delta=(direction==='up'||direction==='left'?-1:1)*Math.round((horizontal?innerWidth:innerHeight)*.75);
          var scroller=action.id==null ? null : targetFor(action,state);
          if(action.id!=null && !scroller) return error('滚动区域已经失效，请重新观察');
          if(!scroller) {
            scroller=state.nodes.filter(function(node) {return visible(node) && node.scrollHeight>node.clientHeight+40 && /(auto|scroll)/.test(style(node).overflowY);})[0];
          }
          didDispatch=true;
          if(scroller) {if(horizontal) scroller.scrollLeft+=delta; else scroller.scrollTop+=delta;}
          else window.scrollBy({top:horizontal?0:delta,left:horizontal?delta:0,behavior:'auto'});
          return {ok:true,dispatched:true};
        }
        var el=targetFor(action,state);
        if(!el || !el.isConnected || !visible(el)) return error('元素已经失效，请重新观察网页','STALE_ELEMENT');
        if(fingerprint(el)!==state.fingerprints[action.id]) return error('目标内容已变化，请重新观察后再操作','TARGET_CHANGED');
        if(disabled(el)) return error('目标已禁用，当前不可操作','DISABLED');
        if(el.scrollIntoView) el.scrollIntoView({block:'center',inline:'nearest',behavior:'auto'});
        if(!unobscured(el)) return error('目标被遮挡或不可点击，请重新观察','OBSCURED');
        if(action.action==='prepare_click') {
          var r=rect(el);
          return {ok:true,x:Math.max(0,Math.min(innerWidth-1,r.x+r.width/2)),y:Math.max(0,Math.min(innerHeight-1,r.y+r.height/2)),
            viewport:viewport(),isTop:window===window.top,scrollX:typeof scrollX==='number'?scrollX:0,scrollY:typeof scrollY==='number'?scrollY:0};
        }
        if(action.action==='click') {
          if(typeof el.click!=='function') return error('目标不支持点击，请使用截图操作');
          didDispatch=true;el.click(); return {ok:true,dispatched:true,method:'dom'};
        }
        if(action.action==='type') {
          if(protectedInput(el) || el.readOnly) return error('受保护的输入框须用户手动填写','HANDOFF_REQUIRED');
          if((el.getAttribute('type') || '').toLowerCase()==='file') return error('文件输入框须通过系统文件选择器上传','FILE_PICKER_REQUIRED');
          if(typeof action.text!=='string' || action.text.length>16000) return error('输入内容无效或超过16000字符');
          var tag=el.tagName.toLowerCase();
          var editable=el.isContentEditable || el.getAttribute('contenteditable')==='true' || el.getAttribute('contenteditable')==='';
          if(tag!=='input' && tag!=='textarea' && !editable) return error('目标不是可编辑输入框');
          el.focus();
          if(!inputEvent(el,'beforeinput',action.text,true)) return error('网页拒绝了本次输入');
          didDispatch=true;
          if(editable) el.textContent=action.text;
          else {
            var owner=el.ownerDocument && el.ownerDocument.defaultView;
            var proto=tag==='textarea' ? (owner && owner.HTMLTextAreaElement || HTMLTextAreaElement).prototype : (owner && owner.HTMLInputElement || HTMLInputElement).prototype;
            var descriptor=Object.getOwnPropertyDescriptor(proto,'value');
            if(descriptor && descriptor.set) descriptor.set.call(el,action.text); else el.value=action.text;
          }
          inputEvent(el,'input',action.text,false);dispatch(el,'change');
          return {ok:true,dispatched:true};
        }
        if(action.action==='choose') {
          if(el.tagName!=='SELECT') return error('目标不是可选下拉框');
          var option=Array.prototype.find.call(el.options,function(o) {return o.value===action.text || (o.text || o.textContent || '').trim()===action.text;});
          if(!option || option.disabled || option.parentElement && option.parentElement.disabled) return error('没有可用的匹配选项');
          didDispatch=true;el.value=option.value; option.selected=true; dispatch(el,'input'); dispatch(el,'change');
          return {ok:true,dispatched:true};
        }
        if(action.action==='submit') {
          var form=el.form || (el.tagName==='FORM'?el:null);
          if(!form) return error('目标没有关联表单，请使用网页提交按钮');
          if(form.checkValidity && !form.checkValidity()) return error('表单尚有未通过校验的内容','INVALID_FORM');
          didDispatch=true;
          if(form.requestSubmit) form.requestSubmit(el.type==='submit'?el:undefined);
          else {
            if(!dispatch(form,'submit',{cancelable:true})) return {ok:true,dispatched:true,handledByPage:true};
            var view=el.ownerDocument && el.ownerDocument.defaultView;
            if(view && view.HTMLFormElement) view.HTMLFormElement.prototype.submit.call(form);
            else return error('当前网页不支持可靠提交，请点击提交按钮');
          }
          return {ok:true,dispatched:true};
        }
        return error('未知操作');
      } catch(e) {var failure=error(String(e && e.message || e));failure.dispatched=didDispatch;return failure;}
    }
    function post(value) {
      var bridge=window.__newsNookAgentBridge;
      if(bridge && typeof bridge.postMessage==='function') bridge.postMessage(JSON.stringify(value));
    }
    function installBridge() {
      if(bridgeInstalled || !window.__newsNookAgentBridge) return;
      bridgeInstalled=true;
      window.__newsNookAgentBridge.onmessage=function(event) {
        var message;
        try {message=JSON.parse(event.data);} catch {return;}
        if(!message || typeof message.runId!=='string') return;
        if(message.type==='cancel') {
          cancelled[message.runId]=true;
          post({type:'cancel_ack',runId:message.runId,requestId:message.requestId,frameId:frameId,documentId:documentId});
          return;
        }
        if(message.type==='resume') {delete cancelled[message.runId]; return;}
        if(message.type!=='command' || typeof message.requestId!=='string') return;
        var result=cancelled[message.runId] ? error('任务已停止或暂停','CANCELLED') : execute(message.args || {});
        Promise.resolve(result).then(function(value) {
          post({type:'result',runId:message.runId,requestId:message.requestId,frameId:frameId,documentId:documentId,result:value});
        },function() {
          post({type:'result',runId:message.runId,requestId:message.requestId,frameId:frameId,documentId:documentId,result:error('网页操作失败')});
        });
      };
      post({type:'ready',frameId:frameId,documentId:documentId,url:location.href,isTop:window===window.top});
    }
    window.__newsNookAgentExecute=execute;
  }
  return JSON.stringify(window.__newsNookAgentExecute(args));
})()
