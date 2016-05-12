var EXPORTED_SYMBOLS = ['MigemoCache', 'MigemoCacheFactory'];

/* This depends on: 
	xmIXMigemoFileAccess
	xmIXMigemoTextUtils
*/
var DEBUG = false;
var TEST = false;
const Cc = Components.classes;
const Ci = Components.interfaces;
 
Components.utils.import('resource://gre/modules/XPCOMUtils.jsm');
Components.utils.import('resource://xulmigemo-modules/core/textUtils.js');
Components.utils.import('resource://xulmigemo-modules/core/fileAccess.js');

const ObserverService = Cc['@mozilla.org/observer-service;1']
			.getService(Ci.nsIObserverService);

const Prefs = Cc['@mozilla.org/preferences;1']
			.getService(Ci.nsIPrefBranch);
 
function MigemoCache() {
}
XMigemoCache.prototype = {
	initialized : false, 

	SYSTEM_DIC : 1 << 0, 
	USER_DIC   : 1 << 1,
	ALL_DIC    : (1 << 0 | 1 << 1),
 
	memCache       : {}, 
	diskCacheClone : {},
	DICTIONARIES_ALL : [
		1 << 0,
		1 << 1,
		(1 << 0 | 1 << 1)
	],
	DICTIONARIES_CHANGABLE : [
		1 << 1,
		(1 << 0 | 1 << 1)
	],
	encoding : 'UTF-8',
 
	init : function(aFileName, aEncoding) 
	{
		if (!aFileName)
			return;

		if (aEncoding)
			this.encoding = aEncoding;

		this.DICTIONARIES_ALL.forEach(function(aType) {
			this.memCache[aType] = '';
			this.diskCacheClone[aType] = '';

			var fileName = aFileName + (aType != this.ALL_DIC ? '-'+aType : '' );
			try {
				var file = Cc['@mozilla.org/file/local;1']
						.createInstance(Ci.nsILocalFile);
				file.initWithPath(this.dicpath);
				file.append(fileName);
				this.setCacheFile(file, aType);
			}
			catch(e) {
				this.setCacheFile(null, aType);
			}
		}, this);
	},
	initWithFileName : function(aFileName)
	{
		this.init(aFileName);
	},
 
	getCacheFor : function (aRoman, aTargetDic) 
	{
		aTargetDic = aTargetDic || this.ALL_DIC;
		var miexp = new RegExp('(^'+MigemoTextUtils.sanitize(aRoman)+'\t.+\n)', 'im');
		if (this.memCache[aTargetDic].match(miexp)) {
			mydump('use memCache');
			return RegExp.$1.split('\t')[1];
		}
		else if (this.diskCacheClone[aTargetDic].match(miexp)) {
			mydump('use diskCacheClone');
			return RegExp.$1.split('\t')[1];
		}
		return '';
	},
 
	clearCacheForAllPatterns : function (aRoman, aTargetDic) 
	{
		var patterns = [];
		for (var i = aRoman.length-1; i > 0; i--)
		{
			var key = aRoman.substring(0, i);
			patterns.push(key);
			this.clearCacheSilentlyFor(key);
		}
		this.save();
		ObserverService.notifyObservers(null, 'XMigemo:cacheCleared', patterns.join('\n'));
	},
 
	clearCacheFor : function (aRoman) 
	{
		this.clearCacheSilentlyFor(aRoman);

		this.save();
		ObserverService.notifyObservers(null, 'XMigemo:cacheCleared', aRoman);
	},
 
	clearCacheSilentlyFor : function (aRoman) 
	{
		var miexp = new RegExp('(^'+aRoman+'\t.+\n)', 'im');
		this.DICTIONARIES_CHANGABLE.forEach(function(aType) {
			var cache = this.memCache[aType] || '';
			this.memCache[aType] = cache.replace(miexp, '');
			if (RegExp.$1) mydump('update memCache for "'+aRoman+'"');

			cache = this.diskCacheClone[aType] || '';
			this.diskCacheClone[aType] = cache.replace(miexp, '');
			if (RegExp.$1) mydump('update diskCache for "'+aRoman+'"');
		}, this);
	},
 
	clearAll : function(aDisk, aTargetDic) 
	{
		if (aTargetDic)
			this.clearAllFor(aTargetDic);
		else
			this.DICTIONARIES_ALL.forEach(this.clearAllFor, this);
	},
	clearAllFor : function (aTargetDic)
	{
		this.memCache[aTargetDic] = '';
		if (aDisk) {
			var file = this.getCacheFile(aTargetDic);
			if (file)
				MigemoFileAccess.writeTo(file, '', this.encoding);
			this.diskCacheClone[aTargetDic] = '';
		}
	},
 
	setMemCache : function(aRoman, aRegExp, aTargetDic) 
	{
		aTargetDic = aTargetDic || this.ALL_DIC;
		var cache = this.memCache[aTargetDic] || '';
		var tmpexp = new RegExp('(^'+MigemoTextUtils.sanitize(aRoman)+'\t.+\n)', 'im');
		if (cache.match(tmpexp)) {
			return;
		}
		else {
			this.memCache[aTargetDic] = cache + aRoman + '\t' + aRegExp + '\n';
			//mydump(this.memCache);

			ObserverService.notifyObservers(null, 'XMigemo:memCacheAdded', aRoman+'\n'+aRegExp);

			return;
		}
	},
 
	setDiskCache : function (aRoman, aMyRegExp, aTargetDic) 
	{
		aTargetDic = aTargetDic || this.ALL_DIC;
		var file = this.getCacheFile(aTargetDic);
		if (!file) return;

		var oldCache = this.diskCacheClone[aTargetDic] || '' ;
		var tmpexp = new RegExp('^' + MigemoTextUtils.sanitize(aRoman) + '\t.+\n', 'im');
		var newCache = oldCache.replace(tmpexp, '')+aRoman+'\t'+aMyRegExp+'\n';
		this.diskCacheClone[aTargetDic] = newCache;
		if (newCache != oldCache)
			this.save(aTargetDic);
	},
 
/* File I/O */ 
	
	getCacheFile : function(aTargetDic) 
	{
		aTargetDic = aTargetDic || this.ALL_DIC;
		return aTargetDic in this.cacheFileHolders ?
				this.cacheFileHolders[aTargetDic] :
				null ;
	},
	setCacheFile : function(aFile, aTargetDic)
	{
		aTargetDic = aTargetDic || this.ALL_DIC;
		this.cacheFileHolders[aTargetDic] = aFile;
	},
	get cacheFile()
	{
		return this.getCacheFile();
	},
	set cacheFile(val)
	{
		this.setCacheFile(val);
		return this.cacheFile;
	},
	cacheFileHolders : {},
	
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
  
	load : function(aTargetDic) 
	{
		if (aTargetDic) {
			if (!this.loadFor(aTargetDic))
				return false;
		}
		else {
			var failedCount = 0;
			this.DICTIONARIES_ALL.forEach(this.loadFor, this);
		}
		this.initialized = this.DICTIONARIES_ALL.every(this.getCacheFile, this);
		if (this.initialized) {
			mydump('xmIXMigemoCache: loaded');
			return true;
		}
		else {
			return false;
		}
	},
	loadFor : function(aTargetDic)
	{
		var file = this.getCacheFile(aTargetDic);
		if (!file)
			return false;

		if (!file.exists()) {
			MigemoFileAccess.writeTo(file, '', this.encoding);
		}
		else {
			this.diskCacheClone[aTargetDic] = MigemoFileAccess.readFrom(file, this.encoding);
		}
		return true;
	},
 
	reload : function(aTargetDic) 
	{
		this.load(aTargetDic);
	},
 
	save : function (aTargetDic) 
	{
		if (aTargetDic)
			this.saveFor(aTargetDic);
		else
			this.DICTIONARIES_ALL.forEach(this.saveFor, this);
	},
	saveFor : function (aTargetDic)
	{
		var file = this.getCacheFile(aTargetDic);
		if (!file)
			return false;

		var cache = MigemoFileAccess.readFrom(file, this.encoding);
		var clone = this.diskCacheClone[aTargetDic];
		if (cache != clone)
			MigemoFileAccess.writeTo(file, clone, this.encoding);

		return true;
	}
  
}; 

var MigemoCacheFactory = {
	_instances : {},
	get : function(aKey, aEncoding)
	{
		if (!this._instances[aKey]) {
			this._instances[aKey] = new MigemoCache();

			var lang = Prefs.getCharPref('xulmigemo.lang');

			var fileNameOverride;
			try {
				fileNameOverride = Prefs.getCharPref('xulmigemo.cache.override.'+lang);
			}
			catch(e) {
			}
			var fileName = fileNameOverride || aKey+'.cache.txt';

			var encodingOverride;
			try {
				encodingOverride = Prefs.getCharPref('xulmigemo.cache.override.'+lang+'.encoding');
			}
			catch(e) {
			}
			aEncoding = encodingOverride || aEncoding || 'UTF-8';

			this._instances[aKey].init(fileName, aEncoding);
		}
		return this._instances[aKey];
	}
};

function mydump(aString) 
{
	if (DEBUG)
		dump((aString.length > 80 ? aString.substring(0, 80) : aString )+'\n');
}
 