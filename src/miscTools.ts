import * as vscode from "vscode";
var fs = require('fs');
const path = require('path'); 
const { exec } = require('child_process');
const util = require('util');

//Searches the current file directory for a specific pattern string and returns all files that match the pattern
export async function searchDirectory(pattern: string) {
  var files = null;
  if (vscode.workspace.workspaceFolders !== undefined) {
    const folder = vscode.workspace.workspaceFolders[0].uri;
    pattern = pattern.replace(folder.fsPath, "");
    let filePattern: vscode.RelativePattern = new vscode.RelativePattern(
      folder.fsPath,
      pattern
    );
    var excludeFolders: Array<string> = vscode.workspace.getConfiguration("p-vscode").get("pcompile.exclude") || ["**/Build/*", "**/build/**"];
    let excludeFilePattern = excludeFolders.length > 1 ? "{" + excludeFolders.join(',') + "}" : excludeFolders.join('');
    files = await vscode.workspace.findFiles(filePattern, excludeFilePattern);
  }
  return files;
}

//Check if P is installed by trying to run it
export async function checkPInstalled(): Promise<boolean> {
  const execPromise = util.promisify(exec);
  try {
    await execPromise(`p --version`);
  } catch(error) {
    return false;
  }
  return true;
}
