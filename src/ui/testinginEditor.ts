import * as vscode from 'vscode';
import { ExtensionConstants, LanguageConstants, TestResults } from '../constants';
const fs = require('fs');

export default class TestingEditor {
    static instance: TestingEditor;
    static controller = vscode.tests.createTestController('pTestController', 'P Tests');
    static testRe = /^\s*test/g;
  

    public static async createAndRegister(context: vscode.ExtensionContext) : Promise<TestingEditor> {
        context.subscriptions.push(TestingEditor.controller);
        context.subscriptions.push(
            //Change Text Document => Update the parsing of a Test File
            //Delete a Text Document => Update parsing of Test File
            vscode.workspace.onDidChangeTextDocument(e => updateNodeFromDocument(e.document)),
            vscode.workspace.onWillDeleteFiles(e => e.files.forEach(async fileUri => {
                updateNodeFromDocument(await vscode.workspace.openTextDocument(fileUri))
            })
            ) 
        )     

        //Looks through the entire test folder to discover where is the test file and where the tests are.
        if (vscode.workspace.workspaceFolders !== undefined) {
            const folder = vscode.workspace.workspaceFolders[0].uri
            let filePattern: vscode.RelativePattern = new vscode.RelativePattern(folder,"PTst/Test*.p" )
            const files = await vscode.workspace.findFiles(filePattern)

            for (var i = 0; i<files.length; i++) {
                var x = files.at(i)
                if (x !== undefined) {
                    updateNodeFromDocument(await vscode.workspace.openTextDocument(x));
            
                }
            }
        }
        return TestingEditor.instance;
    }

}

function updateFromContents(controller: vscode.TestController, content: string, uri: vscode.Uri, item: vscode.TestItem) {
    //If the document has already been parsed, remove all the current children to re-parse.
    if (item.children.size >0) {
        item.children.forEach(child => item.children.delete(child.id))
    }
    
    parsePTestFile(content, {
        onTest: (name, range) => {
            const tCase = controller.createTestItem(range.start.line.toString(), name, uri);
            tCase.range = range;
            item.children.add(tCase);
        }
    })

    if (item.children.size == 0) {
        controller.items.delete(item.id)
    }
    else {
        const runProfile = controller.createRunProfile(
            'Run',
            vscode.TestRunProfileKind.Run,
            (request, token) => {runHandler(request, token);}
        )
    }
}

//Parses a P test file, looking for 'Test Items'
function parsePTestFile(text: string, 
    events: {
        onTest(name: string, range: vscode.Range): void
        }) 
{
    const lines = text.split('\n');

    for (let lineNo = 0; lineNo < lines.length; lineNo++) {
        const line = lines[lineNo];
        const test = TestingEditor.testRe.exec(line);
        if (test) {
            const range = new vscode.Range(new vscode.Position(lineNo, 0), new vscode.Position(lineNo, line.length));
            const words = line.split('test ')[1].split(" ");
            events.onTest(words[0], range);
            continue;
        }

    }
}

//Handles running a Test Run Request
async function runHandler (request: vscode.TestRunRequest, token: vscode.CancellationToken)
 {
    const run = TestingEditor.controller.createTestRun(request);
    const queue: vscode.TestItem[] = [];



    if (request.include) {
        request.include.forEach(test => queue.push(test));
    }

    while (queue.length >0) {
        const test = queue.pop()!;
        run.started(test);
        await handlePTestCase(run, test);
        
    }
    run.end();
}

//If the Test Item is a file: run its children. Else: Run the test case.
async function handlePTestCase(run: vscode.TestRun, tc: vscode.TestItem) {
    if (tc.parent == undefined) {
        tc.children.forEach(item => runPTestCase(run, item))
    }
    else {
        runPTestCase(run, tc);
    }
}

//Always runs a single P Test Case.
async function runPTestCase(run: vscode.TestRun, tc: vscode.TestItem) {
    var result = TestResults.Error;
    let terminal = vscode.window.activeTerminal ?? vscode.window.createTerminal();
    if (terminal.name == ExtensionConstants.RunTask) {
        for (let i = 0; i<vscode.window.terminals.length; i++) {
          if (vscode.window.terminals.at(i)?.name != ExtensionConstants.RunTask) {
            terminal = vscode.window.terminals.at(i) ?? vscode.window.createTerminal();
            break;
          }
        }
        if (terminal.name == ExtensionConstants.RunTask) {
            terminal = vscode.window.createTerminal();
        }
      }
    //Sends P Check command through the terminal
    terminal.show();
    const outputDirectory = "PCheckerOutput/" + tc.label
    var outputFile = outputDirectory + "/check.log";
    if (vscode.workspace.workspaceFolders !== undefined) {
        const outputName = vscode.workspace.workspaceFolders[0].uri.path + "/" +  outputFile;
        if (!fs.existsSync(outputName)) {
            fs.writeFile(outputName, '', function (err: any) {
                if (err) throw err;
            })
        }
    }
    const numIterations: String =  vscode.workspace.getConfiguration("p-vscode").get("iterations")?? "1000";
    const command = "p check -tc " + tc.label + " -o " + outputDirectory + " -i " + numIterations + " |& tee " + outputFile;
    terminal.sendText(command);

    if (vscode.workspace.workspaceFolders !== undefined) {
        const outputName = vscode.workspace.workspaceFolders[0].uri.path + "/" +  outputFile;
        const contents = (await vscode.workspace.openTextDocument(vscode.Uri.file(outputName))).getText();
        if (contents.includes("Found 0 bugs")) {
            result= TestResults.Pass;
        }
        else if (contents.includes("found a bug")) {
            result= TestResults.Fail;
        }
    }
    
    switch (result) {
        case TestResults.Pass: {
            run.passed(tc);
            break;
        }
        case TestResults.Fail: {
            var msg =  new vscode.TestMessage("Failure after P Check Command")
            msg.location = new vscode.Location(tc.uri!, tc.range!);
            run.failed(tc, msg);
            break;
        }
        case TestResults.Error: {
            var msg =  new vscode.TestMessage("Test Errored in Running")
            run.errored(tc, msg);
        }
    }
    return;
}


function updateNodeFromDocument(e: vscode.TextDocument) {
    const name = e.fileName.split("/");
    if (name.at(-1) ==undefined || !name.includes("PTst")) {
        return;
    }
    if (e.uri.scheme !== 'file') {
        return;
    }
    if (!e.uri.path.endsWith('.p')) {
        return;
    }
    const file = getFile(e.uri);
    updateFromContents(TestingEditor.controller, e.getText(), e.uri, file); 
}


//If the Testing File already exists, return the file. If it doesn't, add it to the TestController and then return the file. 
function getFile(uri: vscode.Uri) {
    const existing = TestingEditor.controller.items.get(uri.toString());
	if (existing) {
		return existing;
	}
    const file = TestingEditor.controller.createTestItem(uri.toString(), uri.path.split('/').pop()!, uri);
    TestingEditor.controller.items.add(file);
    file.canResolveChildren = true;
    return file;
}





export class TestFile {


    parsePTestFile(text: string, events: {
            onTest(name: string, range: vscode.Range): void
            }) 
    {
        const lines = text.split('\n');
    
        for (let lineNo = 0; lineNo < lines.length; lineNo++) {
            const line = lines[lineNo];
            const test = TestingEditor.testRe.exec(line);
            if (test) {
                const range = new vscode.Range(new vscode.Position(lineNo, 0), new vscode.Position(lineNo, 0));
                const words = line.split('\s+');
                events.onTest(words[1], range);
                continue;
            }
    
        }
    }
}