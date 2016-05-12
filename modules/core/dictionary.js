/* This depends on: 
	xmIXMigemoFileAccess
	xmIXMigemoTextUtils
	xmIXMigemoTextTransform
*/
var DEBUG = false;
var TEST = false;
var Cc = Components.classes;
var Ci = Components.interfaces;
 
Components.utils.import('resource://gre/modules/XPCOMUtils.jsm'); 
Components.utils.import('resource://xulmigemo-modules/core/textUtils.js');
Components.utils.import('resource://xulmigemo-modules/core/textTransform.js');
Components.utils.import('resource://xulmigemo-modules/core/fileAccess.js');

var ObserverService = Cc['@mozilla.org/observer-service;1']
			.getService(Ci.nsIObserverService);

var Prefs = Cc['@mozilla.org/preferences;1']
			.getService(Ci.nsIPrefBranch);

var MigemoDictionary {
	lang : '',
	
	// MigemoDictionary 
	
	initialized : false, 

 
	RESULT_OK                      : 1 << 0, 
	RESULT_ERROR_INVALID_INPUT     : 1 << 1,
	RESULT_ERROR_ALREADY_EXIST     : 1 << 2,
	RESULT_ERROR_NOT_EXIST         : 1 << 3,
	RESULT_ERROR_NO_TARGET         : 1 << 4,
	RESULT_ERROR_INVALID_OPERATION : 1 << 5,
 
/* File I/O */ 
	
	get dicpath() 
	{
		var fullPath = MigemoFileAccess.getExistingPath(
				decodeURIComponent(escape(Prefs.getCharPref('xulmigemo.dicpath')))
			);
		var relPath = MigemoFileAccess.getExistingPath(
				decodeURIComponent(escape(Prefs.getCharPref('xulmigemo.dicpath-relative')))
			);
		if (relPath && (!fullPath || fullPath != relPath))
			Prefs.setCharPref('xulmigemo.dicpath', unescape(encodeURIComponent(relPath)));

		return fullPath || relPath;
	},
 
	load : function() 
	{
		if (!this.lang) return false;

		var file;
		var dicDir = this.dicpath;

		var error = false;

		if (dicDir) {
			file = Cc['@mozilla.org/file/local;1']
				.createInstance(Ci.nsILocalFile);
			file.initWithPath(dicDir);
			file.append(this.lang+'.txt');
		}
		if (file && file.exists()) {
//			dump('system dic loaded from '+file.path+'\n');
			this.list['system'] = MigemoFileAccess.readFrom(file, 'UTF-8');
		}
		else {
//			dump('system dic not found at '+file.path+'\n');
			this.list['system'] = '';
			error = true;
		}

		// ユーザー辞書
		if (dicDir) {
			file = Cc["@mozilla.org/file/local;1"]
				.createInstance(Ci.nsILocalFile);
			file.initWithPath(dicDir);
			file.append(this.lang+'.user.txt');
		}
		if (file && file.exists()) {
//			dump('user dic loaded from '+file.path+'\n');
			this.list['user'] = MigemoFileAccess.readFrom(file, 'UTF-8');
		}
		else {
//			dump('user dic not found at '+file.path+'\n');
			this.list['user'] = '';
		}


		this.initialized = true;
		mydump('xmIXMigemoDictionary: loaded');

		return !error;
	},
 
	reload : function() 
	{
		this.load();
	},
 
	saveUserDic : function() 
	{
		if (!('user' in this.list)) return;

		var file;
		var dicDir = this.dicpath;
		if (!dicDir) return;

		file = Cc["@mozilla.org/file/local;1"]
				.createInstance(Ci.nsILocalFile);
		file.initWithPath(dicDir);
		file.append(this.lang+'.user.txt');

		MigemoFileAccess.writeTo(file, (this.list['user'] || ''), 'UTF-8');
	},
  
	addTerm : function(aInput, aTerm) 
	{
		return this.modifyDic(
			{
				input : String(arguments[0]),
				term  : String(arguments[1])
			},
			'add'
		);
	},
 
	removeTerm : function(aInput, aTerm) 
	{
		return this.modifyDic(
			{
				input : String(arguments[0]),
				term  : (arguments[1] ? String(arguments[1]) : null )
			},
			'remove'
		);
	},
 
	getDic : function() 
	{
		return this.list['system'];
	},
 
	getUserDic : function() 
	{
		return this.list['user'];
	},
  
	// internal 
	
	list : [], 
 
	modifyDic : function(aTermSet, aOperation) 
	{
		if (
			!aOperation ||
			(aOperation != 'add' && aOperation != 'remove')
			)
			return this.RESULT_ERROR_INVALID_OPERATION;

		var input = aTermSet.input ? String(aTermSet.input) : '' ;
		var term  = aTermSet.term ? String(aTermSet.term) : '' ;
		if (!input || !MigemoTextTransform.isValidInput(input))
			return this.RESULT_ERROR_INVALID_INPUT;

		input = MigemoTextTransform.normalizeInput(input);
		if (aTermSet) aTermSet.input = input;

		if (aOperation == 'add' && !term) {
			return this.RESULT_ERROR_NO_TARGET;
		}

		var systemDic = this.list['system'];
		var userDic   = this.list['user'];

		var regexp;

		if (aOperation == 'add') {
			// デフォルトの辞書に入っている単語は追加しない
			regexp = new RegExp('^'+input+'\t(.+)$', 'm');
			if (regexp.test(systemDic)) {
				var terms = RegExp.$1.split('\t').join('\n');
				regexp = new RegExp('^'+MigemoTextUtils.sanitize(term)+'$', 'm');
				if (regexp.test(terms))
					return this.RESULT_ERROR_ALREADY_EXIST;
			}
		}

		regexp = new RegExp('^'+input+'\t(.+)$', 'm');
		if (regexp.test(userDic)) {
			var terms = RegExp.$1.split('\t').join('\n');
			regexp = new RegExp('^'+MigemoTextUtils.sanitize(term)+'$', 'm');
			if ((aOperation == 'remove' && !term) || regexp.test(terms)) {
				// ユーザ辞書にすでに登録済みである場合
				switch (aOperation)
				{
					case 'add':
						return this.RESULT_ERROR_ALREADY_EXIST;

					case 'remove':
						if (term) {
							terms = terms.replace(regexp, '').replace(/\n\n+/g, '\n').split('\n').join('\t');
							mydump('terms:'+terms.replace(/\t/g, ' / '));
							if (terms) {
								regexp = new RegExp('^('+input+'\t.+)$', 'm');
								regexp.test(userDic);
								entry = input + '\t' + terms.replace(/(^\t|\t$)/, '');
								this.list['user'] = userDic.replace(regexp, entry);
								break;
							}
						}

						regexp = new RegExp('\n?^('+input+'\t.+)\n?', 'm');
						entry = input + '\t';
						this.list['user'] = userDic.replace(regexp, '');
						break;
				}
			}
			else {
				// ユーザ辞書にエントリはあるが、その語句は登録されていない場合
				switch (aOperation)
				{
					case 'add':
						regexp = new RegExp('^('+input+'\t.+)$', 'm');
						regexp.test(userDic);
						entry = RegExp.$1 + '\t' + term;
						this.list['user'] = userDic.replace(regexp, entry);
						break;

					case 'remove':
						return this.RESULT_ERROR_NOT_EXIST;
				}
			}
		}
		else {
			// ユーザ辞書に未登録の場合
			switch (aOperation)
			{
				case 'add':
					entry = input + '\t' + term;
					this.list['user'] = [userDic, entry, '\n'].join('');
					break;

				case 'remove':
					return this.RESULT_ERROR_NOT_EXIST;
			}
		}

		this.saveUserDic();

		mydump('XMigemo:dictionaryModified('+aOperation+') '+entry);
		ObserverService.notifyObservers(this, 'XMigemo:dictionaryModified',
			[
				'',
				aOperation + '\t' + input + '\t' + term,
				entry
			].join('\n'));

		return this.RESULT_OK;
	}
  
}; 

function mydump(aString) 
{
	if (DEBUG)
		dump((aString.length > 80 ? aString.substring(0, 80) : aString )+'\n');
}
 