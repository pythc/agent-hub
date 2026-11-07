"""Open a tool through the real workspace launcher when it has no tab yet."""
def open_resource(page, name):
    if not page.locator('.resource-workspace').count():
        page.get_by_role('button',name='Session panel',exact=True).click()
    tab=page.locator('.resource-tabs').get_by_role('tab',name=name,exact=True)
    if tab.count():tab.click()
    else:
        page.get_by_role('button',name='New workspace tab',exact=True).click()
        page.locator('.resource-tool-grid').get_by_role('button',name=name,exact=True).click()

async def open_resource_async(page, name):
    if not await page.locator('.resource-workspace').count():
        await page.get_by_role('button',name='Session panel',exact=True).click()
    tab=page.locator('.resource-tabs').get_by_role('tab',name=name,exact=True)
    if await tab.count():await tab.click()
    else:
        await page.get_by_role('button',name='New workspace tab',exact=True).click()
        await page.locator('.resource-tool-grid').get_by_role('button',name=name,exact=True).click()

async def open_workspace_async(page):
    await page.get_by_role('link',name='Current workspace',exact=True).click()
    await page.get_by_role('dialog',name='Switch workspace').get_by_role('button',name='Close',exact=True).click()
