"""Packaged board copy/meaning checks on the isolated agent-board-acceptance host.

Decision variants below are explicit response fixtures; no model or production
account is used. They exercise missing/zero/partial usage and advisory semantics.
"""
import copy
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

root=Path(sys.argv[1]);info=json.loads((root/'browser.json').read_text())
out=root/'copy-screenshots';out.mkdir(exist_ok=True);errors=[];checks=[]
variant={}
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    context=browser.new_context(viewport={'width':1440,'height':1000})
    name,value=info['cookie'].split('=',1)
    context.add_cookies([{'name':name,'value':value,'url':info['base']}])
    page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
    def fixture(route):
        response=route.fetch();data=response.json()
        data['decision'].update(copy.deepcopy(variant))
        route.fulfill(response=response,json=data)
    page.route('**/api/workspace-views/*/runtime?*',fixture)
    try:
        page.goto(info['url']);page.wait_for_load_state('networkidle')
        page.get_by_role('button',name='Switch to Chinese',exact=True).click()
        frame=page.frame_locator('iframe[title="Agent 看板"]')
        frame.get_by_role('tab',name='监听与用量',exact=True).click()
        usage=frame.locator('.usage');rows=usage.locator('dl > div')
        expect(usage.locator('.badge')).to_have_text('未开启')
        expect(rows.locator('dd')).to_have_text(['360','18','1 / 2 条','1 / 2 条'])
        expect(rows.locator('dt')).to_have_text(['输入 token','输出 token','有输入用量的记录','有输出用量的记录'])
        expect(usage.locator('.usage-context')).to_contain_text('全部来源')
        expect(usage.locator('dl')).to_have_attribute('aria-description',usage.locator('dl').get_attribute('title'))
        expect(frame.locator('.scope-note')).to_have_count(0)
        expect(frame.locator('.flow-step small')).to_have_count(0)
        expect(frame.locator('.board')).not_to_contain_text('用量覆盖')
        expect(frame.locator('.board')).not_to_contain_text('影子模式')
        expect(frame.locator('.decision-outcome')).to_contain_text(['建议不处理','需要进一步判断'])
        expect(frame.locator('.record-meta')).to_contain_text(['仅记录','提供建议'])
        # The source filter must not suggest the auxiliary model totals were filtered.
        frame.get_by_role('combobox',name='按来源筛选').select_option('personal')
        expect(frame.locator('.flow-step strong').first).to_have_text('11')
        expect(rows.locator('dd')).to_have_text(['360','18','1 / 2 条','1 / 2 条'])
        expect(usage.locator('.usage-context')).to_contain_text('全部来源')
        frame.get_by_role('combobox',name='按来源筛选').select_option('')
        checks.append('Partial usage, reported-record denominator, probe exclusion and all-source scope retained')

        variant.update(mode='shadow',inputTokens=None,outputTokens=0,inputReported=0,outputReported=1,retained=2)
        # The bridge intentionally throttles explicit refreshes for 300 ms.
        page.wait_for_timeout(350);frame.get_by_role('button',name='刷新看板').click()
        expect(usage.locator('.badge')).to_have_text('仅记录')
        expect(usage.locator('.badge')).to_have_attribute('title','仍会调用辅助模型，只记录判断结果，不影响 Router 的处理。')
        expect(rows.locator('dd')).to_have_text(['未知','0','0 / 2 条','1 / 2 条'])
        variant.update(mode='advisory',inputTokens=None,outputTokens=None,inputReported=0,outputReported=0,retained=0,records=[])
        # The bridge intentionally throttles explicit refreshes for 300 ms.
        page.wait_for_timeout(350);frame.get_by_role('button',name='刷新看板').click()
        expect(usage.locator('.badge')).to_have_text('提供建议')
        expect(rows.locator('dd')).to_have_text(['未知','未知','0 / 0 条','0 / 0 条'])
        expect(frame.get_by_text('尚无模型判断记录。',exact=True)).to_be_visible()
        checks.append('Off/record-only/advisory distinctions; zero remains zero, unknown stays unknown, no-record counts stay 0/0')

        actions=['STOP','CONTINUE','IGNORE','INTERVENE','REVIEW','FUTURE_ACTION']
        records=[{'id':'copy-'+str(i),'at':1700000000000+i,'mode':'shadow' if i%2 else 'advisory',
                  'model':'lightweight-model','status':'ok','latencyMs':42,'actions':[action]}
                 for i,action in enumerate(actions)]
        records.extend({'id':'status-'+status,'at':1700000000000,'mode':'advisory','model':'lightweight-model',
                        'status':status,'latencyMs':42,'actions':[]}
                       for status in ['unavailable','stale','skipped','FUTURE_STATUS'])
        variant.update(mode='shadow',inputTokens=360,outputTokens=18,inputReported=1,outputReported=1,retained=10,records=records)
        # The bridge intentionally throttles explicit refreshes for 300 ms.
        page.wait_for_timeout(350);frame.get_by_role('button',name='刷新看板').click()
        expect(frame.locator('.decision-action')).to_have_text(['建议停止','建议跟进','建议不处理','建议介入','需要进一步判断','未知建议'])
        expect(frame.locator('.decision-action').first).to_have_attribute('title','模型判断消息要求停止已有任务，并不代表任务已经停止。')
        expect(frame.locator('.record-meta')).to_contain_text(['已返回判断']*6+['未获得有效结果','本次判断已失效','本次已跳过','未知状态'])
        expect(frame.locator('.decision-action').last).to_have_attribute('title','FUTURE_ACTION')
        expect(frame.get_by_text('无判断结果',exact=True)).to_have_count(4)
        page.screenshot(path=str(out/'listening-zh-light.png'))
        page.get_by_role('button',name='切换为深色模式',exact=True).click()
        expect(frame.locator('html')).to_have_class('dark')
        page.screenshot(path=str(out/'listening-zh-dark.png'))
        checks.append('Judgments remain suggestions, all decision states translated, unknown future values do not become successful actions')

        page.get_by_role('button',name='切换为英文',exact=True).click()
        frame=page.frame_locator('iframe[title="Agent board"]');usage=frame.locator('.usage')
        expect(usage.locator('.badge')).to_have_text('Record only')
        expect(usage.locator('dl dd')).to_have_text(['360','18','1 / 10 records','1 / 10 records'])
        expect(frame.locator('.decision-action')).to_have_text(['Suggest stopping','Suggest following up','Suggest no action','Suggest stepping in','Needs further review','Unknown suggestion'])
        page.set_viewport_size({'width':390,'height':844});page.emulate_media(reduced_motion='reduce')
        for node in [page.locator('html'),frame.locator('html')]:
            assert node.evaluate('(e)=>e.scrollWidth<=e.clientWidth+1')
        usage.scroll_into_view_if_needed();page.screenshot(path=str(out/'listening-en-mobile-dark.png'))
        page.get_by_role('button',name='Switch to Chinese',exact=True).click()
        frame=page.frame_locator('iframe[title="Agent 看板"]')
        for node in [page.locator('html'),frame.locator('html')]:
            assert node.evaluate('(e)=>e.scrollWidth<=e.clientWidth+1')
        page.screenshot(path=str(out/'listening-zh-mobile-dark.png'))
        checks.append('English/Chinese and black/white rendering; 390px without horizontal overflow')

        page.set_viewport_size({'width':1440,'height':1000})
        frame.get_by_role('tab',name='任务',exact=True).click()
        frame.locator('.task-row').first.click();dialog=frame.get_by_role('dialog')
        expect(dialog).to_be_visible();expect(dialog).to_contain_text('已读回执');expect(dialog).to_contain_text('未收到')
        expect(dialog).not_to_contain_text('未读');expect(dialog).not_to_contain_text('未发送')
        frame.get_by_role('button',name='关闭详情').press('Escape')
        frame.get_by_role('tab',name='总览',exact=True).click()
        frame.get_by_role('button',name='查看 Research',exact=True).click()
        expect(frame.get_by_role('dialog')).to_contain_text('模型连接')
        expect(frame.get_by_role('dialog')).to_contain_text('当前执行数')
        frame.get_by_role('button',name='关闭详情').press('Escape')
        checks.append('Task/agent detail labels and receipt uncertainty; Escape still closes details')
        assert not errors,errors
    except Exception:
        page.screenshot(path=str(out/'failure.png'))
        raise
    finally:
        (root/'copy-results.json').write_text(json.dumps({'checks':checks,'pageErrors':errors,'fixture':True},ensure_ascii=False,indent=2))
        browser.close()
print(json.dumps({'checks':checks,'pageErrors':errors},ensure_ascii=False))
