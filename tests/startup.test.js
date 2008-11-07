// 文字列等に非ASCII文字を使う場合は、ファイルのエンコーディングを
// UTF-8にしてください。

utils.include('common.inc.js');

function normalSetUp(aURI)
{
	yield utils.setUpTestWindow();

	var retVal = utils.addTab(aURI);
	yield retVal;

	browser = utils.getBrowser();
	browser.removeAllTabsBut(retVal.tab);

	win = utils.getTestWindow();

	content = win.content;

	gFindBar = win.gFindBar;

	XMigemoUI = win.XMigemoUI;
	XMigemoHighlight = win.XMigemoHighlight;

	findCommand = 'with (win) {'+
		win.document.getElementById('cmd_find').getAttribute('oncommand')+
	'}';

	field = XMigemoUI.field;
	inputElem = field.inputField;

	yield wait;
}


assert.findbarState = function(aMode, aShown) {
	assert.equals(XMigemoUI[aMode], XMigemoUI.findMode, aMode);
	if (aShown)
		assert.isFalse(XMigemoUI.hidden, aMode);
	else
		assert.isTrue(XMigemoUI.hidden, aMode);
}

var startupTest = new TestCase('起動時の設定のテスト');

startupTest.tests = {
	setUp : function() {
		utils.setPref('xulmigemo.findMode.always', -1);
		utils.setPref('xulmigemo.findMode.default', 0);
		utils.setPref('xulmigemo.checked_by_default.findbar', false);
		utils.setPref('xulmigemo.checked_by_default.highlight', false);
		utils.setPref('xulmigemo.checked_by_default.highlight.always', false);
		utils.setPref('xulmigemo.checked_by_default.caseSensitive', false);
		utils.setPref('xulmigemo.checked_by_default.caseSensitive.always', false);
	},

	tearDown : function() {
		commonTearDown();
	},

	'起動時に検索ツールバーを表示：OFF': function() {
		utils.setPref('xulmigemo.checked_by_default.findbar', false);
		yield Do(normalSetUp(keyEventTest));
		assert.findbarState('FIND_MODE_NATIVE', false);
	},

	'起動時に検索ツールバーを表示：ON': function() {
		utils.setPref('xulmigemo.checked_by_default.findbar', true);
		yield Do(normalSetUp(keyEventTest));
		assert.findbarState('FIND_MODE_NATIVE', true);
	},

	'起動時のモード：通常検索': function() {
		utils.setPref('xulmigemo.findMode.default', 1);
		yield Do(normalSetUp(keyEventTest));
		assert.findbarState('FIND_MODE_NATIVE', false);
	},

	'起動時のモード：正規表現検索': function() {
		utils.setPref('xulmigemo.findMode.default', 4);
		yield Do(normalSetUp(keyEventTest));
		assert.findbarState('FIND_MODE_REGEXP', false);
	},

	'起動時のモード：Migemo検索': function() {
		utils.setPref('xulmigemo.findMode.default', 2);
		yield Do(normalSetUp(keyEventTest));
		assert.findbarState('FIND_MODE_MIGEMO', false);
	}
};
