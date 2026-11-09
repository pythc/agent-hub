"""Verify an isolated delegation-acceptance --keep host; never use a live account."""
import argparse
import json
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("browser_file", type=Path, help="Private browser.json from the fixture acceptance runner")
parser.add_argument("output", type=Path, help="New private evidence directory")
parser.add_argument("--chrome", default="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
args = parser.parse_args()
config = json.loads(args.browser_file.read_text())
args.output.mkdir(mode=0o700, parents=True, exist_ok=False)
errors, console_errors, states, failed_responses = [], [], [], []
result = {"passed": False, "states": states, "errors": errors, "consoleErrors": console_errors, "failedResponses": failed_responses}

try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=args.chrome, headless=True)
        try:
            page = browser.new_page(viewport={"width": 1440, "height": 1000})
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
            page.on("response", lambda response: failed_responses.append({"status": response.status, "url": response.url}) if response.status >= 400 else None)
            page.goto(config["base"] + "/configure#deployments", wait_until="networkidle")
            page.locator("#field-username").fill(config["username"])
            page.locator("#field-password").fill(config["password"])
            page.get_by_role("button", name="Sign in", exact=True).click()
            expect(page.locator("#field-username")).to_be_hidden(timeout=30000)
            page.goto(config["base"] + "/configure#deployments", wait_until="networkidle")
            expect(page.get_by_role("heading", name="Deployments", exact=True)).to_be_visible()

            refreshes = []
            page.on("request", lambda request: refreshes.append(request.url) if request.url == config["base"] + "/deployments" else None)
            page.evaluate("location.hash = 'tasks'")
            page.wait_for_timeout(3400)
            page.evaluate("location.hash = 'deployments'")
            expect(page.get_by_role("heading", name="Deployments", exact=True)).to_be_visible()
            page.wait_for_timeout(3500)
            assert refreshes, "Automatic refresh did not resume after navigating back"
            before_hidden = len(refreshes)
            page.evaluate("Object.defineProperty(document, 'hidden', {configurable: true, get: () => true})")
            page.wait_for_timeout(3400)
            page.evaluate("delete document.hidden")
            page.wait_for_timeout(3500)
            assert len(refreshes) > before_hidden, "Automatic refresh did not resume after visibility returned"
            result["pollingResumesAfterNavigationAndVisibility"] = True

            for language in ("en", "zh"):
                if language == "zh":
                    page.get_by_role("button", name="Switch to Chinese", exact=True).click()
                for theme in ("light", "dark"):
                    if page.locator("html").get_attribute("data-theme") != theme:
                        label = ("Switch to light mode" if theme == "light" else "Switch to dark mode") if language == "en" else ("切换为浅色模式" if theme == "light" else "切换为深色模式")
                        page.get_by_role("button", name=label, exact=True).click()
                    expect(page.locator("html")).to_have_attribute("data-theme", theme)
                    for width in (1440, 390):
                        page.set_viewport_size({"width": width, "height": 1000})
                        if width <= 800:
                            expect(page.locator(".functions-sidebar")).to_have_css("transform", "matrix(1, 0, 0, 1, -64, 0)")
                        expect(page.get_by_role("heading", name="Deployments" if language == "en" else "部署", exact=True)).to_be_visible()
                        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "Horizontal overflow"
                        assert page.locator("input[type=password]").count() == 1, "Pairing code must stay masked"
                        page.screenshot(path=str(args.output / f"{language}-{theme}-{width}.png"), full_page=True, animations="disabled")
                        states.append({"language": language, "theme": theme, "width": width, "overflow": False})

            page.set_viewport_size({"width": 1440, "height": 1000})
            page.get_by_role("button", name="切换为英文", exact=True).click()
            if config.get("goal"):
                graph = page.locator(".delegation-goal")
                expect(graph).to_have_count(1)
                expect(graph).to_contain_text("Completed")
                expect(graph.locator(".delegation-node")).to_have_count(1)
                expect(graph).to_contain_text("Child team")
                task = page.locator(".delegation-task")
                expect(task).to_contain_text("Independently verified · goal completed")
                task.locator(".delegation-verification summary").click()
                expect(task.get_by_text("Overall goal acceptance", exact=True)).to_be_visible()
                expect(task.get_by_text("Node acceptance", exact=True)).to_be_visible()
                expect(page.get_by_role("button", name="Mark reviewed after checking", exact=True)).to_have_count(0)
                page.wait_for_timeout(3500)
                expect(task.locator(".delegation-verification")).to_have_attribute("open", "")
                graph.screenshot(path=str(args.output / "goal-graph.png"), animations="disabled")
                result["goalGraphAndIndependentAcceptance"] = True
            name = page.get_by_label("Team name", exact=True)
            secret = page.get_by_label("Pairing code from the other instance", exact=True)
            name.fill("Unsaved team draft")
            name.press("Tab")
            expect(secret).to_be_focused()
            page.wait_for_timeout(3500)  # Cross the real background refresh interval.
            expect(name).to_have_value("Unsaved team draft")
            result["keyboardAndDraftPersistence"] = True

            if config.get("goal"):
                expect(page.get_by_role("button", name="Create pairing code", exact=True)).to_be_disabled()
                expect(page.get_by_text("Bind the dedicated delegation source to a management scope before pairing.", exact=True)).to_be_visible()
                result["unconfiguredExportScopeIsDisabled"] = True
            else:
                page.get_by_role("button", name="Create pairing code", exact=True).click()
                code = page.get_by_label("Private pairing code", exact=True)
                expect(code).to_be_visible()
                ticket = json.loads(__import__("base64").b64decode(code.input_value()))
                assert ticket["identity"]["id"] and ticket["code"]
                page.get_by_role("button", name="Hide code", exact=True).click()
                expect(code).to_have_count(0)
                result["pairingCodeCreateAndHide"] = True

            page.get_by_role("button", name="Inspect evidence", exact=True).click()
            evidence = page.locator(".delegation-evidence")
            expect(evidence).to_be_visible()
            expect(evidence).to_contain_text("input.txt")
            expect(evidence).to_contain_text("Worker report")
            expect(evidence).to_contain_text("53c234e5e8472b6ac51c1ae1cab3fe06fad053beb8ebfd8977b010655bfdd3c3")
            result["evidenceRead"] = True
            page.screenshot(path=str(args.output / "evidence.png"), full_page=True)

            page.get_by_role("button", name="Pause new intake", exact=True).click()
            expect(page.get_by_role("button", name="Resume intake", exact=True)).to_be_visible()
            assert page.request.get(config["base"] + "/deployments").json()["targets"][0]["state"] == "paused"
            page.get_by_role("button", name="Resume intake", exact=True).click()
            expect(page.get_by_role("button", name="Pause new intake", exact=True)).to_be_visible()
            result["intakePauseAndResume"] = True

            page.emulate_media(reduced_motion="reduce")
            page.get_by_role("button", name="Stop this delegation", exact=True).click()
            expect(page.locator(".delegation-task .deployment-status")).to_contain_text("Remote completed · stop request reconciled", timeout=15000)
            result["completedThenCancelledReconciliation"] = True
            result["reducedMotion"] = page.evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches")
            page.get_by_role("button", name="Revoke connection", exact=True).click()
            expect(page.get_by_text("Connection revoked", exact=True)).to_be_visible()
            assert page.request.get(config["base"] + "/deployments").json()["connections"][0]["active"] is False
            result["connectionRevocation"] = True
            page.reload(wait_until="networkidle")
            expect(page.get_by_text("Connection revoked", exact=True)).to_be_visible()
            result["reloadPersistence"] = True
            # The unchanged shell probes these optional contracts and explicitly
            # falls back on 404. Keep them visible; reject every other failure.
            known = {"/workspaces", "/connection-capabilities"}
            expected = [r for r in failed_responses if r["status"] == 404 and urlparse(r["url"]).path in known]
            unexpected = [r for r in failed_responses if r not in expected]
            unexpected_console = [message for message in console_errors if not (expected and message == "Failed to load resource: the server responded with a status of 404 (Not Found)")]
            result["expectedCompatibility404s"] = expected
            result["unexpectedResponses"] = unexpected
            result["unexpectedConsoleErrors"] = unexpected_console
            assert not errors and not unexpected and not unexpected_console, "Unexpected browser errors were recorded"
            result["passed"] = True
        finally:
            browser.close()
finally:
    (args.output / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
print(json.dumps({"passed": result["passed"], "states": len(states), "evidence": str(args.output / "result.json")}))
