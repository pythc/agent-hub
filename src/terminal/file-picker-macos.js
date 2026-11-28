// Executed by macOS JavaScript for Automation, not Node.
function run(argv) {
  var app = Application.currentApplication()
  app.includeStandardAdditions = true
  ObjC.import('AppKit')
  $.NSApplication.sharedApplication.activateIgnoringOtherApps(true)
  try {
    var files = app.chooseFile({ withPrompt: argv[1], defaultLocation: Path(argv[0]), multipleSelectionsAllowed: true })
    return JSON.stringify(files.map(function (file) { return file.toString() }))
  } catch (error) {
    if (error.errorNumber === -128) return '[]'
    throw error
  }
}
