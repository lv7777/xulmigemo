var EXPORTED_SYMBOLS = ['XMigemoMail'];

var DEBUG = false;
function log(...aArgs) 
{
	if (DEBUG ||
		Services.prefs.getBoolPref('xulmigemo.debug.all') ||
		Services.prefs.getBoolPref('xulmigemo.debug.mail'))
		Services.console.logStringMessage(aArgs.join(', '));
}

var TEST = false; 
var Cc = Components.classes;
var Ci = Components.interfaces;
var Cu = Components.utils;

Cu.import('resource://gre/modules/Services.jsm');
Cu.import('resource:///modules/quickFilterManager.js');

Cu.import('resource://xulmigemo-modules/service.jsm');
Cu.import('resource://xulmigemo-modules/core/textUtils.js');


var XMigemoMail = {
	get DBConnection()
	{
		if (typeof GlodaDatastore === 'undefined')
			Cu.import('resource:///modules/gloda/datastore.js');

		return GlodaDatastore.syncConnection;
	},

	FIND_SUBJECT   : (1 << 0),
	FIND_BODY      : (1 << 1),
	FIND_AUTHOR    : (1 << 2),
	FIND_RECIPIENT : (1 << 3),
 
	getTermsList : function(aInput, aFindTargets, aFolder) 
	{
		aFolder.QueryInterface(Ci.nsIMsgFolder);
		var terms = [];
		try {
			var columns = [];
			if (aFindTargets & this.FIND_SUBJECT) columns.push('c.c0subject');
			if (aFindTargets & this.FIND_BODY) columns.push('c.c1body');
			if (aFindTargets & this.FIND_AUTHOR) columns.push('c.c3author');
			if (aFindTargets & this.FIND_RECIPIENT) columns.push('c.c4recipients');
			if (columns.length) {
				columns = columns.map(function(aColumn) {
					return 'COALESCE(' + aColumn + ', "")';
				});

				let regexp;
				if (
					XMigemoService.getPref('xulmigemo.autostart.regExpFind') &&
					MigemotextUtils.isRegExp(aInput)
					) {
					regexp = MigemotextUtils.extractRegExpSource(aInput);
					regexp = new RegExp(regexp, 'ig');
				}
				else {
					regexp = XMigemoCore.getRegExp(aInput);
				}
				regexp = new RegExp(regexp, 'ig');

				let sql = ' \
					SELECT GROUP_CONCAT(%COLUMNS%, ?1) \
					  FROM messagesText_content c \
					       LEFT JOIN messages m ON m.id = c.docid \
					       LEFT JOIN folderLocations f ON f.id = m.folderID \
					  WHERE f.folderURI = ?2 \
					'.replace('%COLUMNS%', columns.join(' || '));
				let statement = this.DBConnection.createStatement(sql);
				statement.bindStringParameter(0, '\n');
				statement.bindStringParameter(1, aFolder.folderURL);

				var sources;
				while(statement.executeStep())
				{
					sources = statement.getString(0);
				}
				statement.reset();

				terms = sources.replace(/\n/g, ' ').match(regexp);
				if (terms && terms.length)
					terms = MigemotextUtils.brushUpTerms(terms);
			}
		}
		catch(e) {
		}
		terms = terms || [];
		return terms;
	},

	init : function()
	{
		if (typeof MessageTextFilter != 'undefined' &&
			!('__xmigemo_original_appendTerms' in MessageTextFilter)) {
			MessageTextFilter.__xmigemo_original_appendTerms = MessageTextFilter.appendTerms;
			MessageTextFilter.appendTerms = this.MessageTextFilter_appendTerms;
		}
	},
	MessageTextFilter_appendTerms : function(aTermCreator, aTerms, aFilterValue)
	{
		var activeWindow = Cc['@mozilla.org/focus-manager;1']
							.getService(Ci.nsIFocusManager)
							.activeWindow;
		if (
			activeWindow &&
			aFilterValue.text &&
			aFilterValue.states &&
			XMigemoService.getPref('xulmigemo.mailnews.threadsearch.enabled')
			) {
			let targets = 0;
			if (aFilterValue.states.subject)
				targets |= XMigemoMail.FIND_SUBJECT;
			if (aFilterValue.states.body)
				targets |= XMigemoMail.FIND_BODY;
			if (aFilterValue.states.sender)
				targets |= XMigemoMail.FIND_AUTHOR;
			if (aFilterValue.states.recipients)
				targets |= XMigemoMail.FIND_RECIPIENT;
			let terms = XMigemoMail.getTermsList(
					aFilterValue.text,
					targets,
					activeWindow.gDBView.msgFolder
				);
			if (terms.length)
				aFilterValue.text = terms.join(' ');
		}

		return this.__xmigemo_original_appendTerms(aTermCreator, aTerms, aFilterValue);
	}
};

XMigemoMail.init();
