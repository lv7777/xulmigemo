var EXPORTED_SYMBOLS = ['MigemoFind'];

/* This depends on: 
	MigemoCoreFactory
	MigemoTextUtils
*/
var DEBUG = false;
var TEST = false;
var Cc = Components.classes;
var Ci = Components.interfaces;
 
Components.utils.import('resource://gre/modules/XPCOMUtils.jsm'); 
Components.utils.import('resource://xulmigemo-modules/core/core.js');
Components.utils.import('resource://xulmigemo-modules/core/textUtils.js');

var nsIDocShellTreeItem = Ci.nsIDocShellTreeNode || Ci.nsIDocShellTreeItem; // nsIDocShellTreeNode is merged to nsIDocShellTreeItem by https://bugzilla.mozilla.org/show_bug.cgi?id=331376

var boxObjectModule = {};
function getBoxObjectFor(aNode)
{
	if (!('boxObject' in boxObjectModule)) {
		Components.utils.import(
			'resource://xulmigemo-modules/lib/boxObject.js',
			boxObjectModule
		);
	}
	return boxObjectModule
			.boxObject
			.getBoxObjectFor(aNode);
}
 
function MigemoFind()
{
	this.foundRangeMap = new WeakMap();
	this.foundEditableMap = new WeakMap();
	this.lastFoundEditableMap = new WeakMap();
}

MigemoFind.NOTFOUND          = 0;
MigemoFind.FOUND             = 1 << 0;
MigemoFind.WRAPPED           = 1 << 1;
MigemoFind.FOUND_IN_LINK     = 1 << 2;
MigemoFind.FOUND_IN_EDITABLE = 1 << 3;
MigemoFind.FINISH_FIND       = 1 << 4;
 
MigemoFind.FIND_DEFAULT     = 1 << 0;
MigemoFind.FIND_BACK        = 1 << 1;
MigemoFind.FIND_FORWARD     = 1 << 2;
MigemoFind.FIND_WRAP        = 1 << 3;
MigemoFind.FIND_IN_LINK     = 1 << 7;
MigemoFind.FIND_IN_EDITABLE = 1 << 8;
MigemoFind.FIND_SILENTLY    = 1 << 9; // for internal use

MigemoFind.FIND_MODE_NATIVE = 1 << 0;
MigemoFind.FIND_MODE_MIGEMO = 1 << 1;
MigemoFind.FIND_MODE_REGEXP = 1 << 2;

MigemoFind.prototype = {	
	lastKeyword     : '', 
	previousKeyword : '',
	lastFoundWord   : '',
	
	appendKeyword : function(aString) 
	{
		if (!this.targetDocShell)
			throw new Error('not initialized yet');

		this.lastKeyword += aString;
		return this.lastKeyword;
	},
 
	replaceKeyword : function(aString) 
	{
		if (!this.targetDocShell)
			throw new Error('not initialized yet');

		this.lastKeyword = aString;
		return this.lastKeyword;
	},
 
	removeKeyword : function(aLength) 
	{
		if (!this.targetDocShell)
			throw new Error('not initialized yet');

		this.lastKeyword = this.lastKeyword.substr(0, this.lastKeyword.length - aLength);
		return this.lastKeyword;
	},
 
	shiftLastKeyword : function() 
	{
		if (!this.targetDocShell)
			throw new Error('not initialized yet');

		this.previousKeyword = this.lastKeyword;
	},
  
	get isLinksOnly() 
	{
		return this.manualLinksOnly ||
			(this.isQuickFind && this.prefs.getPref('xulmigemo.linksonly'));
	},
	set isLinksOnly(val)
	{
		this.manualLinksOnly = val;
		return this.isLinksOnly;
	},
	isQuickFind     : false,
	manualLinksOnly : false,

	startFromViewport : false,
 
	lastResult        : MigemoFind.NOTFOUND,
	NOTFOUND          : MigemoFind.NOTFOUND,
	FOUND             : MigemoFind.FOUND,
	WRAPPED           : MigemoFind.WRAPPED,
	FOUND_IN_LINK     : MigemoFind.FOUND_IN_LINK,
	FOUND_IN_EDITABLE : MigemoFind.FOUND_IN_EDITABLE,
	FINISH_FIND       : MigemoFind.FINISH_FIND,

	FIND_DEFAULT     : MigemoFind.FIND_DEFAULT,
	FIND_BACK        : MigemoFind.FIND_BACK,
	FIND_FORWARD     : MigemoFind.FIND_FORWARD,
	FIND_WRAP        : MigemoFind.FIND_WRAP,
	FIND_IN_LINK     : MigemoFind.FIND_IN_LINK,
	FIND_IN_EDITABLE : MigemoFind.FIND_IN_EDITABLE,
	FIND_SILENTLY    : MigemoFind.FIND_SILENTLY,

	FIND_MODE_NATIVE : MigemoFind.FIND_MODE_NATIVE,
	FIND_MODE_MIGEMO : MigemoFind.FIND_MODE_MIGEMO,
	FIND_MODE_REGEXP : MigemoFind.FIND_MODE_REGEXP,
	findMode : MigemoFind.FIND_MODE_NATIVE,
 
	set targetDocShell(val) 
	{
		if (val) {
			this._targetDocShell = val;
			this.init();
		}
		return this._targetDocShell;
	},
	get targetDocShell()
	{
		return this._targetDocShell;
	},
	_targetDocShell : null,

	get targetDocument()
	{
		return (
			this.targetDocShell &&
			this.targetDocShell.QueryInterface(Ci.nsIWebNavigation).document
		);
	},
	
/*
	get document() 
	{
		if (!this.target)
			throw new Error('not initialized yet');

		return this.target.ownerDocument;
	},
 
	get window() 
	{
		return this.document.defaultView;
	},
*/
  
	set core(val) 
	{
		if (val) {
			this._core = val;
		}
		return this._core;
	},
	get core()
	{
		if (!this._core) {
			var lang = this.prefs.getPref('xulmigemo.lang');
			this._core = MigemoCoreFactory.get(lang);
		}
		return this._core;
	},
	_core : null,
 
	get prefs() 
	{
		delete this.prefs;
		let { prefs } = Components.utils.import('resource://xulmigemo-modules/lib/prefs.js', {});
		return this.prefs = prefs;
	},
 
	get animationManager() 
	{
		delete this.animationManager;
		let { animationManager } = Components.utils.import('resource://xulmigemo-modules/lib/animationManager.js', {});
		return this.animationManager = animationManager;
	},
 
/* Find */ 
	
	get mFind() 
	{
		if (!this._mFind)
			this._mFind = Cc['@mozilla.org/embedcomp/rangefind;1']
					.createInstance(Ci.nsIFind);
		return this._mFind;
	},
	_mFind : null,
 
	get caseSensitive() 
	{
		return this._caseSensitive && this.findMode != this.FIND_MODE_MIGEMO;
	},
	set caseSensitive(aValue)
	{
		this._caseSensitive = aValue;
		return aValue;
	},
	_caseSensitive : false,
 
	findNext : function(aForceFocus) 
	{
		if (!this.targetDocShell)
			throw new Error('not initialized yet');

		this.find(false, this.lastKeyword || this.previousKeyword, aForceFocus);
	},
 
	findPrevious : function(aForceFocus) 
	{
		if (!this.targetDocShell)
			throw new Error('not initialized yet');

		this.find(true, this.lastKeyword || this.previousKeyword, aForceFocus);
	},
 
	find : function(aParams) 
	{
		aParams = aParams || {};
		var aBackward      = aParams.backward || false;
		var aKeyword       = aParams.keyword || '';
		var aForceFocus    = aParams.forceFocus || false;
		var aScrollToFound = aParams.scroll || false;

		if (!this.targetDocShell)
			new Error('not initialized yet');

mydump("find");
		if (!aKeyword) {
			this.lastResult = this.NOTFOUND;
			return this.lastResult;
		}

		this.viewportStartPoint = null;
		this.viewportEndPoint   = null;

		var myExp;
		switch (this.findMode)
		{
			case this.FIND_MODE_MIGEMO:
				myExp = this.core.getRegExp(aKeyword);
				break;

			case this.FIND_MODE_REGEXP:
				if (MigemoTextUtils.isRegExp(aKeyword))
					this.caseSensitive = !/\/[^\/]*i[^\/]*$/.test(aKeyword);
				myExp = MigemoTextUtils.extractRegExpSource(aKeyword);
				break;

			default:
				myExp = aKeyword;
				break;
		}

		if (!myExp) {
			this.previousKeyword = aKeyword;
			return this.lastResult;
		}

		var findFlag = 0;
		if (this.previousKeyword != aKeyword) findFlag |= this.FIND_DEFAULT;

		findFlag |= aBackward ? this.FIND_BACK : this.FIND_FORWARD ;

		if (this.isLinksOnly)
			findFlag |= this.FIND_IN_LINK;

		if (!aScrollToFound)
			findFlag |= this.FIND_SILENTLY;

		var targetDocShell = this.targetDocShell;

		if (aScrollToFound) {
			let win = this.targetDocument.defaultView;
			let sel = win.getSelection();
			if (sel && !sel.rangeCount) {
				let lastFrame = this.getLastFindTargetFrame(win.top);
				if (lastFrame)
					targetDocShell = DocShellIterator.prototype.getDocShellFromFrame(lastFrame);
			}
		}

		var iterator = new DocShellIterator(targetDocShell, aBackward);
		this.lastResult = this.findInDocument(findFlag, myExp, iterator, aParams);
		iterator.destroy();
		this.previousKeyword = aKeyword;
		return this.lastResult;
	},
	
	findInDocument : function(aFindFlag, aFindTerm, aDocShellIterator, aOptions) 
	{
mydump("findInDocument ==========================================");
		aOptions = aOptions || {};

		var rangeSet;
		var doc;
		var resultFlag;

		var isEditable     = false;
		var isPrevEditable = false;
		var editableInOut  = false;

		if (this.findMode != this.FIND_MODE_NATIVE) {
			var flags = 'm';
			if (!this.caseSensitive) flags += 'i';
			if (aFindFlag & this.FIND_BACK) flags += 'g';
			aFindTerm = new RegExp(aFindTerm, flags);
		}

		while (true)
		{
			doc = aDocShellIterator.document;

			if (!aDocShellIterator.isFindable) {
				rangeSet = null;
				resultFlag = this.NOTFOUND;
			}
			else {
				rangeSet = this.getFindRangeSet(aFindFlag, aDocShellIterator);

				isPrevEditable = isEditable;
				isEditable     = this.getParentEditableFromRange(rangeSet.range) ? true : false ;
				editableInOut  = isEditable != isPrevEditable;

				resultFlag = this.findInDocumentInternal(aFindFlag, aFindTerm, rangeSet, doc, aOptions);
			}

			if (resultFlag & this.FINISH_FIND) {
				break;
			}

			if (!(aFindFlag & this.FIND_SILENTLY) &&
				aDocShellIterator.isFindable) {
				this.clearSelection(doc);
				this.clearSelectionLook(doc);
			}

			aDocShellIterator.iterateNext();

			if (aDocShellIterator.wrapped) {
				if (!(aFindFlag & this.FIND_WRAP)) {
					if (
						!editableInOut ||
						!rangeSet ||
						aDocShellIterator.isRangeTopLevel(rangeSet.range)
						)
						aFindFlag |= this.FIND_WRAP;
					continue;
				}
				break;
			}

			if (aDocShellIterator.isInitial) {
				break;
			}
		}

		if (resultFlag & this.FINISH_FIND)
			resultFlag ^= this.FINISH_FIND;

		return resultFlag;
	},
	
	findInDocumentInternal : function(aFindFlag, aFindTerm, aRangeSet, aDocument, aOptions) 
	{
		aOptions = aOptions || {};

		var textFindResult;
		var rangeFindResult;
		var rangeText = MigemoTextUtils.range2Text(aRangeSet.range);
		var restText;
		var doc;

		this.foundRange = null;

		while (true)
		{
			if (this.isLinksOnly) {
				var links = aDocument.getElementsByTagName('a');
				if (!links.length)
					return this.NOTFOUND;
			}

			textFindResult = this.findInText(aFindFlag, aFindTerm, rangeText);
			restText = textFindResult.restText;
			rangeFindResult = this.findInRange(aFindFlag, textFindResult.foundTerm, aRangeSet);

			if (rangeFindResult.flag & this.FOUND) {
				if (this.isLinksOnly && !(rangeFindResult.flag & this.FOUND_IN_LINK)) {
					rangeText = restText;
					this.foundRange = rangeFindResult.range;
					this.resetFindRangeSet(aRangeSet, this.foundRange, aFindFlag, aDocument);
					continue;
				}
				this.foundRange = rangeFindResult.range;
				this.lastFoundWord = this.foundRange.toString();
				doc = this.foundRange.commonAncestorContainer;
				if (doc.parentNode) doc = doc.parentNode;
				if (doc.ownerDocument) doc = doc.ownerDocument;
				if (rangeFindResult.flag & this.FOUND_IN_EDITABLE) {
					this.foundEditableMap.set(doc, rangeFindResult.foundEditable);
					this.lastFoundEditableMap.set(doc, rangeFindResult.foundEditable);
				}
				else {
					this.foundEditableMap.delete(doc);
				}
				if (!(aFindFlag & this.FIND_SILENTLY)) {
					if (aOptions.forceFocus)
						doc.defaultView.focus();
					if (rangeFindResult.flag & this.FOUND_IN_LINK)
						this.focusToLink(aOptions.forceFocus);
					this.setSelectionAndScroll(this.foundRange, aRangeSet.range.startContainer.ownerDocument || aRangeSet.range.startContainer);
				}
				rangeFindResult.flag |= this.FINISH_FIND;
				if (aFindFlag & this.FIND_WRAP)
					rangeFindResult.flag |= this.WRAPPED;
			}
			return rangeFindResult.flag;
		}
	},
 
	findInText : function(aFindFlag, aTerm, aText) 
	{
		var result = {
				foundTerm : null,
				restText  : aText
			};
		if (this.findMode != this.FIND_MODE_NATIVE) {
			if (aText.match(aTerm)) {
				result.foundTerm = RegExp.lastMatch;
				result.restText = (aFindFlag & this.FIND_BACK) ? RegExp.leftContext : RegExp.rightContext ;
			}
		}
		else if (aFindFlag & this.FIND_BACK) {
			var index = aText.lastIndexOf(aTerm);
			if (index > -1) {
				result.foundTerm = aTerm;
				result.restText = aText.substring(0, index-1);
			}
		}
		else {
			var index = aText.indexOf(aTerm);
			if (index > -1) {
				result.foundTerm = aTerm;
				result.restText = aText.substring(index+1);
			}
		}
		return result;
	},
  
	findInRange : function(aFindFlag, aTerm, aRangeSet) 
	{
mydump("findInRange");
		var result = {
				flag          : this.NOTFOUND,
				range         : null,
				foundEditable : null,
				foundLink     : null
			};
		if (!aTerm) {
			return result;
		}

		this.mFind.findBackwards = Boolean(aFindFlag & this.FIND_BACK);
		this.mFind.caseSensitive = true;

		result.range = this.mFind.Find(aTerm, aRangeSet.range, aRangeSet.start, aRangeSet.end) || null ;
		if (!result.range) {
			return result;
		}

		result.flag = this.FOUND;

		if (result.foundEditable = this.getParentEditableFromRange(result.range)) {
			result.flag |= this.FOUND_IN_EDITABLE;
		}
		if (result.foundLink = this.getParentLinkFromRange(result.range)) {
			result.flag |= this.FOUND_IN_LINK;
		}

		return result;
	},
	
	focusToLink : function(aForceFocus) 
	{
		var link = this.getParentLinkFromRange(this.foundRange);
		if (link && aForceFocus) {
			link.focus();
		}
		this.updateStatusBarWithDelay(link);
		return link;
	},
   
	getParentLinkFromRange : function(aRange) 
	{
mydump("getParentLinkFromRange");
		//後でXLinkを考慮したコードに直す
		if (!aRange) return null;
		var node = aRange.commonAncestorContainer;
		while (node && node.parentNode)
		{
			if (String(node.localName).toLowerCase() == 'a') {
				return node;
			}
			node = node.parentNode;
		}
		return null;
	},
 
	getParentEditableFromRange : function(aRange) 
	{
mydump('getParentEditableFromRange');
		if (aRange) aRange.QueryInterface(Ci.nsIDOMRange);
		var node = aRange.commonAncestorContainer;
		while (node && node.parentNode)
		{
			var isEditable = false;
			try {
				node = node.QueryInterface(Ci.nsIDOMNSEditableElement);
				if (node.editor)
					return node;
			}
			catch(e) {
			}
			node = node.parentNode;
		}
		return null;
	},
	getFindRangeFromRangeInEditable : function(aRange) 
	{
		var owner = this.getParentEditableFromRange(aRange);
		var lastContainer = aRange.startContainer;
		while (lastContainer.parentNode != owner)
		{
			lastContainer = lastContainer.parentNode;
		}
		var range = lastContainer.ownerDocument.createRange();
		range.selectNodeContents(lastContainer);
		return range;
	},
  
/* Range Manipulation */ 
	
	getFindRangeSet : function(aFindFlag, aDocShellIterator) 
	{
mydump("getFindRangeSet");
		var doc       = aDocShellIterator.document;
		var docShell  = aDocShellIterator.current;
		var docSelCon = this.getSelectionController(aDocShellIterator.view);

		if (aFindFlag & this.FIND_SILENTLY) {
			let range = this.foundRange;
			if (range) {
				let editable = this.getParentEditableFromRange(range);
				if (editable &&
					editable.ownerDocument == doc) {
					let selCon = this.getSelectionController(editable);
					return this.getFindRangeSetIn(aFindFlag, aDocShellIterator, editable, selCon);
				}
			}
		}
		else {
			let lastFoundEditable = this.lastFoundEditableMap.get(doc);
			if (lastFoundEditable) {
				let selCon = this.getSelectionController(lastFoundEditable);
				let selection = selCon.getSelection(selCon.SELECTION_NORMAL);
				if (selection.rangeCount) {
					let testRange2, node;
					if (aFindFlag & this.FIND_BACK) {
						testRange2 = selection.getRangeAt(0);
						node = testRange2.startContainer;
					}
					else {
						testRange2 = selection.getRangeAt(selection.rangeCount-1);
						node = testRange2.endContainer;
					}
					while (node != lastFoundEditable &&
							node.parentNode != lastFoundEditable)
						node = node.parentNode;
					return this.getFindRangeSetIn(aFindFlag, aDocShellIterator, node, selCon);
				}

				selection.removeAllRanges();

				let testRange1 = doc.createRange();
				testRange1.selectNode(lastFoundEditable);
				if (aFindFlag & this.FIND_BACK) {
					testRange1.setEndBefore(lastFoundEditable);
				}
				else {
					testRange1.setStartAfter(lastFoundEditable);
				}
				selection = docSelCon.getSelection(docSelCon.SELECTION_NORMAL);
				selection.addRange(testRange1);
				this.lastFoundEditableMap.delete(doc);
			}
		}

		return this.getFindRangeSetIn(aFindFlag, aDocShellIterator, aDocShellIterator.body, docSelCon);
	},
	
	getFindRangeSetIn : function(aFindFlag, aDocShellIterator, aRangeParent, aSelCon) 
	{
mydump("getFindRangeSetIn "+aRangeParent);
		var doc = aDocShellIterator.document;

		var findRange = doc.createRange();
		findRange.selectNodeContents(aRangeParent);
		var startPt = findRange.cloneRange();
		var endPt = findRange.cloneRange();

		var foundRange;
		if (aFindFlag & this.FIND_SILENTLY) {
			foundRange = this.foundRange;
		}
		else {
			let selection;
			let count = 0;
			if (aSelCon) {
				selection = aSelCon.getSelection(aSelCon.SELECTION_NORMAL);
				count = selection.rangeCount;
			}
			if (count > 0) {
				if (aFindFlag & this.FIND_BACK)
					foundRange = selection.getRangeAt(0);
				else
					foundRange = selection.getRangeAt(count-1);
			}
		}

		var lastFoundEditable = this.lastFoundEditableMap.get(doc);
		if (
			(
				aFindFlag & this.FIND_SILENTLY ||
				!(aFindFlag & this.FIND_DEFAULT)
			) &&
			foundRange
			) {
			let editable = this.getParentEditableFromRange(foundRange);
			if (editable) {
				findRange = this.getFindRangeFromRangeInEditable(foundRange);
			}
			startPt = findRange.cloneRange();
			endPt = findRange.cloneRange();
			if (aFindFlag & this.FIND_BACK) {
				findRange.setEnd(foundRange.startContainer, foundRange.startOffset);
				startPt = foundRange.cloneRange();
				startPt.collapse(true);
				endPt.collapse(true);
			}
			else {
				findRange.setStart(foundRange.endContainer, foundRange.endOffset);
				startPt = foundRange.cloneRange();
				startPt.collapse(false);
				endPt.collapse(false);
			}
		}
		else if (aFindFlag & this.FIND_SILENTLY &&
				lastFoundEditable) {
			this.lastFoundEditableMap.delete(doc);
			if (aFindFlag & this.FIND_BACK) {
				findRange.setEndBefore(lastFoundEditable);
				startPt = findRange.cloneRange();
				startPt.collapse(false);
			}
			else {
				findRange.setStartAfter(lastFoundEditable);
				startPt = findRange.cloneRange();
				startPt.collapse(true);
			}
		}
		else if (
				aFindFlag & this.FIND_SILENTLY ||
				aFindFlag & this.FIND_WRAP ||
				String(aRangeParent.localName).toLowerCase() != 'body' ||
				!this.startFromViewport
				) {
				if (aFindFlag & this.FIND_BACK) {
					startPt.collapse(false);
					endPt.collapse(true);
				}
				else {
					startPt.collapse(true);
					endPt.collapse(false);
				}
		}
		else {
			if (aFindFlag & this.FIND_BACK) {
				let node = this.viewportStartPoint ||
						MigemoTextUtils.findFirstVisibleNode(doc, true);
				this.viewportStartPoint = node;
				findRange.setEndAfter(node);
				startPt.setStartAfter(node);
				startPt.setEndAfter(node);
				endPt.collapse(true);
			}
			else {
				let node = this.viewportEndPoint ||
						MigemoTextUtils.findFirstVisibleNode(doc, false);
				this.viewportEndPoint = node;
				findRange.setStartBefore(node);
				startPt.setStartBefore(node);
				startPt.setEndBefore(node);
				endPt.collapse(false);
			}
		}

		var ret = {
			range : findRange,
			start : startPt,
			end   : endPt,
			owner : aRangeParent
		};

		return ret;
	},
 
	get foundRange()
	{
		return this.foundRangeMap.get(this.targetDocument);
	},
	set foundRange(aValue)
	{
		if (aValue)
			this.foundRangeMap.set(this.targetDocument, aValue);
		else
			this.foundRangeMap.delete(this.targetDocument);
		return aValue;
	},
 
	viewportStartPoint : null, 
	viewportEndPoint   : null,
  
	resetFindRangeSet : function(aRangeSet, aFoundRange, aFindFlag, aDocument) 
	{
mydump("resetFindRangeSet");
/*
		var win = this.document.commandDispatcher.focusedWindow;
		var theDoc = (win && win.top != this.window.top) ?
					win.document :
					aDocument ;
*/
		var theDoc = aDocument;

		var root = DocShellIterator.prototype.getDocumentBody(theDoc);
		aRangeSet.range.selectNodeContents(root);
		aRangeSet.start.selectNodeContents(root);

		var node;
		var offset;
		if (aFindFlag & this.FIND_DEFAULT || aFindFlag & this.FIND_FORWARD) {
			node = aFoundRange.endContainer;
			offset = aFoundRange.endOffset;
			aRangeSet.range.setStart(node, offset);
			aRangeSet.start.setStart(node, offset);
			aRangeSet.start.setEnd(node, offset);
		}
		else if (aFindFlag & this.FIND_BACK) {
			node = aFoundRange.startContainer;
			offset = aFoundRange.startOffset;
			aRangeSet.range.setEnd(node, offset);
			aRangeSet.start.setStart(node, offset);
			aRangeSet.start.setEnd(node, offset);
		}
		return aRangeSet;
	},
  
/* Update Appearance */ 
	
	getSelectionController : function(aTarget) 
	{
		if (!aTarget) return null;

		const nsIDOMNSEditableElement = Ci.nsIDOMNSEditableElement;
		const nsIDOMWindow = Ci.nsIDOMWindow;
		try {
			return (aTarget instanceof nsIDOMNSEditableElement) ?
						aTarget.QueryInterface(nsIDOMNSEditableElement)
							.editor
							.selectionController :
					(typeof aTarget.Window == 'function' && aTarget instanceof aTarget.Window) ?
						DocShellIterator.prototype.getDocShellFromFrame(aTarget)
							.QueryInterface(Ci.nsIInterfaceRequestor)
							.getInterface(Ci.nsISelectionDisplay)
							.QueryInterface(Ci.nsISelectionController) :
					null;
		}
		catch(e) {
		}
		return null;
	},
 
	clearSelectionLook : function(aDocument) 
	{
		if (aDocument) aDocument.QueryInterface(Ci.nsIDOMDocument);
		var foundEditable = this.foundEditableMap.get(aDocument);
		if (foundEditable)
			this.clearSelectionLookInternal(foundEditable);
		this.clearSelectionLookInternal(aDocument);
	},
	clearSelectionLookInternal : function(aTarget) 
	{
		var selCon = this.getSelectionController(aTarget);
		if (!selCon)
			return;

		selCon.setDisplaySelection(selCon.SELECTION_ON);
		selCon.repaintSelection(selCon.SELECTION_NORMAL);
	},
 
	setSelectionAndScroll : function(aRange, aDocument) 
	{
mydump("setSelectionAndScroll");
		if (!aRange && !aDocument) return;

		if (!aDocument)
			aDocument = aRange.startContainer.ownerDocument || aRange.startContainer;

		// clear old range
		var foundEditable = this.foundEditableMap.get(aDocument);
		var lastFoundEditable = this.lastFoundEditableMap.get(aDocument);
		[
			(foundEditable || lastFoundEditable),
			aDocument.defaultView
		].forEach(function(aTarget) {
			var oldSelCon = this.getSelectionController(aTarget);
			if (!oldSelCon) return;
			var selection = oldSelCon.getSelection(oldSelCon.SELECTION_NORMAL);
			selection.removeAllRanges();
		}, this);

		// set new range
		var editableParent = this.getParentEditableFromRange(aRange);
		var newSelCon = this.getSelectionController(editableParent) ||
				this.getSelectionController(aDocument.defaultView);
		var selection = newSelCon.getSelection(newSelCon.SELECTION_NORMAL);
		selection.addRange(aRange);

		newSelCon.setDisplaySelection(newSelCon.SELECTION_ATTENTION);
		newSelCon.repaintSelection(newSelCon.SELECTION_NORMAL);

		if (this.prefs.getPref('xulmigemo.scrollSelectionToCenter'))
			this.scrollSelectionToCenter(aDocument.defaultView, false, editableParent);
		else
			newSelCon.scrollSelectionIntoView(
				newSelCon.SELECTION_NORMAL,
				newSelCon.SELECTION_FOCUS_REGION,
				true);
	},
	
	scrollSelectionToCenter : function(aFrame, aPreventAnimation, aOwnerEditable) 
	{
		if (!this.prefs.getPref('xulmigemo.scrollSelectionToCenter'))
			return;

		if (aFrame)
			aFrame.QueryInterface(Ci.nsIDOMWindow);

		var frame = aFrame;
		if (!frame && this.document) {
			frame = this.document.commandDispatcher.focusedWindow;
			if (!frame || frame.top == this.document.defaultView)
				frame = this.window._content;
			frame = this.getSelectionFrame(frame);
		}
		if (!frame)
			return;

		var selection = frame.getSelection();
		if (
			(!selection || !selection.rangeCount) &&
			!aOwnerEditable
			)
			return;

		var padding = Math.max(0, Math.min(100, this.prefs.getPref('xulmigemo.scrollSelectionToCenter.padding')));

		var startX = frame.scrollX;
		var startY = frame.scrollY;
		var targetX,
			targetY,
			targetW,
			targetH;

		var box = getBoxObjectFor(aOwnerEditable || selection.getRangeAt(0));
		if (box.fixed)
			return;

		targetX = box.x;
		targetY = box.y;
		targetW = box.width;
		targetH = box.height;

		var viewW = frame.innerWidth;
		var xUnit = viewW * (padding / 100);
		var finalX = (targetX - startX < xUnit) ?
						targetX - xUnit :
					(targetX + targetW - startX > viewW - xUnit) ?
						targetX + targetW - (viewW - xUnit) :
						startX ;

		var viewH = frame.innerHeight;
		var yUnit = viewH * (padding / 100);
		var finalY = (targetY - startY < yUnit ) ?
						targetY - yUnit  :
					(targetY + targetH - startY > viewH - yUnit ) ?
						targetY + targetH - (viewH - yUnit)  :
						startY ;

		if (frame.__xulmigemo__findSmoothScrollTask) {
			this.animationManager.removeTask(frame.__xulmigemo__findSmoothScrollTask);
			frame.__xulmigemo__findSmoothScrollTask = null;
		}

		if (aPreventAnimation ||
			!this.prefs.getPref('xulmigemo.scrollSelectionToCenter.smoothScroll.enabled')) {
			frame.scrollTo(finalX, finalY);
			return;
		}

		var deltaX = finalX - startX;
		var deltaY = finalY - startY;
		var radian = 90 * Math.PI / 180;
		frame.__xulmigemo__findSmoothScrollTask = function(aTime, aBeginning, aChange, aDuration) {
			var x, y, finished;
			if (aTime >= aDuration) {
				frame.__xulmigemo__findSmoothScrollTask = null;
				x = finalX;
				y = finalY
				finished = true;
			}
			else {
				x = startX + (deltaX * Math.sin(aTime / aDuration * radian));
				y = startY + (deltaY * Math.sin(aTime / aDuration * radian));
				finished = false;
			}
			frame.scrollTo(x, y);
			return finished;
		};
		this.animationManager.addTask(
			frame.__xulmigemo__findSmoothScrollTask,
			0, 0, this.prefs.getPref('xulmigemo.scrollSelectionToCenter.smoothScroll.duration'),
			frame
		);
	},
 
	getSelectionFrame : function(aFrame) 
	{
		var selection = aFrame.getSelection();
		if (selection && selection.rangeCount)
			return aFrame;

		var frame;
		for (var i = 0, maxi = aFrame.frames.length; i < maxi; i++)
		{
			frame = arguments.callee(aFrame.frames[i]);
			if (frame) return frame;
		}
		return null;
	},
 
	getPageOffsetTop : function(aNode) 
	{
		if (!aNode) return 0;
		var top = aNode.offsetTop;
		while (aNode.offsetParent != null)
		{
			aNode = aNode.offsetParent;
			top += aNode.offsetTop;
		}
		return top;
	},
  
	clearSelection : function(aDocument) 
	{
		var foundEditable = this.foundEditableMap.get(aDocument);
		var lastFoundEditable = this.lastFoundEditableMap.get(aDocument);
		if (foundEditable || lastFoundEditable)
			(foundEditable || lastFoundEditable)
				.QueryInterface(Ci.nsIDOMNSEditableElement)
				.editor.selection.removeAllRanges();

		var sel = aDocument.defaultView.getSelection();
		if (sel) sel.removeAllRanges();
	},
 
	updateStatusBar : function(aLink) 
	{
		var xulBrowserWindow;
		try {
			xulBrowserWindow = this.window
					.QueryInterface(Ci.nsIInterfaceRequestor)
					.getInterface(Ci.nsIWebNavigation)
					.QueryInterface(Ci.nsIDocShellTreeItem)
					.treeOwner
					.QueryInterface(Ci.nsIInterfaceRequestor)
					.getInterface(Ci.nsIXULWindow)
					.XULBrowserWindow;
		}
		catch(e) {
		}
		if (!xulBrowserWindow) return;

		if (!aLink || !aLink.href) {
			xulBrowserWindow.setOverLink('', null);
		}
		else {
			var charset = aLink.ownerDocument.characterSet;
			var uri = Cc['@mozilla.org/intl/texttosuburi;1']
						.getService(Ci.nsITextToSubURI)
						.unEscapeURIForUI(charset, aLink.href);
			xulBrowserWindow.setOverLink(uri, null);
		}
	},
	
	updateStatusBarWithDelay : function(aLink) 
	{
		this.cancelUpdateStatusBarTimer();
		this.updateStatusBarTimer = Cc['@mozilla.org/timer;1']
				.createInstance(Ci.nsITimer);
		this.updateStatusBarTimer.init(
			this.createDelayedUpdateStatusBarObserver(aLink),
			1,
			Ci.nsITimer.TYPE_ONE_SHOT
		);
	},
	cancelUpdateStatusBarTimer : function(aLink)
	{
		try {
			if (this.updateStatusBarTimer) {
				this.updateStatusBarTimer.cancel();
				this.updateStatusBarTimer = null;
			}
		}
		catch(e) {
		}
	},
	createDelayedUpdateStatusBarObserver : function(aLink)
	{
		return ({
				owner   : this,
				link    : aLink,
				observe : function(aSubject, aTopic, aData)
				{
					this.owner.updateStatusBar(this.link);
					this.link = null;
					this.owner.cancelUpdateStatusBarTimer();
					this.owner = null;
				}
			});
	},
   
	clear : function(aFocusToFoundTarget) 
	{
		if (!this.targetDocShell)
			throw new Error('not initialized yet');

		this.lastKeyword        = '';
		this.viewportStartPoint = null;
		this.viewportEndPoint   = null;
		this.lastFoundWord      = '';

/*
		var win = this.document.commandDispatcher.focusedWindow;
		var doc = (win != this.window) ?
					win.document :
					this.target.contentDocument;
*/
		var doc = this.targetDocument;

		this.exitFind(aFocusToFoundTarget);

		this.foundEditableMap.delete(doc);
		this.lastFoundEditableMap.delete(doc);
	},
 
	exitFind : function(aFocusToFoundTarget) 
	{
		if (!this.targetDocShell)
			throw new Error('not initialized yet');

/*
		var win = this.document.commandDispatcher.focusedWindow;
		var doc = (win != this.window) ?
					win.document :
					this.target.contentDocument;
*/
		var doc = this.targetDocument;

		this.clearSelectionLook(doc);

		if (!aFocusToFoundTarget) return;

		var WindowWatcher = Cc['@mozilla.org/embedcomp/window-watcher;1']
				.getService(Ci.nsIWindowWatcher);
		if (this.window != WindowWatcher.activeWindow) return;

/*
		win = doc.defaultView;
		if (!this.focusToFound(win))
			win.focus();
*/
	},
	
	focusToFound : function(aFrame) 
	{
		if (Array.slice(aFrame.frames).some(function(aFrame) {
				return this.focusToFound(aFrame);
			}, this))
			return true;

		var range = this.getFoundRange(aFrame);
		if (range) {
			range.QueryInterface(Ci.nsIDOMRange);
			var foundLink = this.getParentLinkFromRange(range);
			var foundEditable = this.getParentEditableFromRange(range);
			var target = foundLink || foundEditable;
			if (target) {
				if ('focus' in target)
					target.focus();
				if (!foundLink) {
					var selCon = this.getSelectionController(foundEditable);
					var selection = selCon.getSelection(selCon.SELECTION_NORMAL);
					if (selection && selection.rangeCount)
						selection.collapseToStart();
				}
				return true;
			}
			aFrame.focus();
			return true;
		}
		return false;
	},
 
	getFoundRange : function(aFrame) 
	{
		var range;
		var foundEditable = this.foundEditableMap.get(aFrame.document);
		if ([foundEditable, aFrame].some(function(aTarget) {
				var selCon = this.getSelectionController(aTarget);
				if (!selCon ||
					selCon.getDisplaySelection() != selCon.SELECTION_ATTENTION)
					return false;
				var sel = selCon.getSelection(selCon.SELECTION_NORMAL);
				if (sel && sel.rangeCount)
					range = sel.getRangeAt(0);
				return range;
			}, this))
			return range;

		return null;
	},
 
	getLastFindTargetFrame : function(aFrame) 
	{
		var foundEditable = this.foundEditableMap.get(aFrame.document);
		if ([foundEditable, aFrame].some(function(aTarget) {
				var selCon = this.getSelectionController(aTarget);
				if (!selCon ||
					selCon.getDisplaySelection() != selCon.SELECTION_ATTENTION)
					return false;
				var sel = selCon.getSelection(selCon.SELECTION_NORMAL);
				return (sel && sel.rangeCount);
			}, this))
			return aFrame;

		var frame;
		if (Array.slice(aFrame.frames).some(function(aFrame) {
				frame = this.getLastFindTargetFrame(aFrame);
				return frame;
			}, this))
			return frame;

		return null;
	},
  
/* nsIPrefListener(?) */ 
	
	domain  : 'xulmigemo', 
 
	observe : function(aSubject, aTopic, aData) 
	{
		switch (aTopic)
		{
			case 'nsPref:changed':
				switch (aData)
				{
					case 'xulmigemo.startfromviewport':
						this.startFromViewport = this.prefs.getPref('xulmigemo.startfromviewport');
						return;
				}
				return;

			default:
				switch (aData)
				{
					case 'quit-application':
						this.destroy();
						return;
				}
				return;
		}
	},

  
	init : function() 
	{
		if (this.initialized) return;

		this.initialized = true;

		try {
			this.prefs.addPrefListener(this);
		}
		catch(e) {
		}

		this.observe(null, 'nsPref:changed', 'xulmigemo.startfromviewport');


/*
		var service = this;
		this.window.addEventListener('unload', function() {
			service.window.removeEventListener('unload', arguments.callee, false);
			service.destroy();
		}, false);
*/

		// Initialize
		this.core;
	},
 
	destroy : function() 
	{
		try {
			this.prefs.removePrefListener(this);
		}
		catch(e) {
		}
	}
 
}; 
  
/* DocShell Traversal */ 
function DocShellIterator(aDocShell, aFromBack)
{
	this.mInitialDocShell = aDocShell;
	this.mCurrentDocShell = this.mInitialDocShell;
	this.mFromBack = aFromBack;
	if (this.mFromBack)
		this.mInitialDocShell =
			this.mCurrentDocShell =
				this.getLastChildDocShell(this.mCurrentDocShell) || this.mCurrentDocShell ;
}

DocShellIterator.prototype = {
	mCurrentDocShell : null,
	mInitialDocShell : null,
	mFromBack : false,

	wrapped : false,
	
	get current() 
	{
		return this.mCurrentDocShell;
	},
	get root()
	{
		return this.getDocShellFromFrame(this.view.top);
	},
	get document()
	{
		return this.mCurrentDocShell
			.QueryInterface(Ci.nsIDocShell)
			.QueryInterface(Ci.nsIWebNavigation)
			.document;
	},
	get view()
	{
		return this.mCurrentDocShell
			.QueryInterface(Ci.nsIDocShell)
			.QueryInterface(Ci.nsIWebNavigation)
			.QueryInterface(Ci.nsIInterfaceRequestor)
			.getInterface(Ci.nsIDOMWindow);
	},
	
	getDocShellFromFrame : function(aFrame) 
	{
		return aFrame
			.QueryInterface(Ci.nsIInterfaceRequestor)
			.getInterface(Ci.nsIWebNavigation)
			.QueryInterface(Ci.nsIDocShell);
	},
  
	get body() 
	{
		return this.getDocumentBody(this.document);
	},
	
	getDocumentBody : function(aDocument) 
	{
		if (aDocument.body)
			return aDocument.body;

		try {
			var xpathResult = aDocument.evaluate(
					'descendant::*[contains(" BODY body ", concat(" ", local-name(), " "))]',
					aDocument,
					null,
					Ci.nsIDOMXPathResult.FIRST_ORDERED_NODE_TYPE,
					null
				);
			return xpathResult.singleNodeValue;
		}
		catch(e) {
		}
		return null;
	},
  
	get isInitial() 
	{
		return this.mCurrentDocShell == this.mInitialDocShell;
	},
	get initialDocument()
	{
		return this.mInitialDocShell
			.QueryInterface(Ci.nsIDocShell)
			.QueryInterface(Ci.nsIWebNavigation)
			.document;
	},
 
	iterateNext : function() 
	{
		this.wrapped = false;
		if (this.mFromBack) {
			nextItem = this.getPrevDocShell(this.mCurrentDocShell);
			if (!nextItem) {
				nextItem = this.getLastChildDocShell(this.root) || this.root ;
				this.wrapped = true;
			}
		}
		else {
			nextItem = this.getNextDocShell(this.mCurrentDocShell);
			if (!nextItem) {
				nextItem = this.root;
				this.wrapped = true;
			}
		}
		this.mCurrentDocShell = nextItem;
		return nextItem;
	},
	
	getNextDocShell : function(aNode) 
	{
		aNode.QueryInterface(nsIDocShellTreeItem);
		// 子がある場合、最初の子を返す
		if (aNode.childCount) return aNode.getChildAt(0);
		var curNode = aNode;
		var curItem;
		var parentNode;
		var parentItem;
		var childOffset;
		while (curNode)
		{
			// このノードが最上位である場合、検索終了
			curItem = curNode.QueryInterface(Ci.nsIDocShellTreeItem);
			var parentItem = curItem.sameTypeParent;
			if (!parentItem) return null;

			// nextSiblingに相当するノードを取得して返す
			childOffset = this.getChildOffsetFromDocShellNode(curNode);
			parentNode = parentItem.QueryInterface(Ci.nsIDocShellTreeItem);
			if (childOffset > -1 && childOffset < parentNode.childCount-1)
				return parentNode.getChildAt(childOffset+1);

			// nextSiblingに相当するノードが無いので、
			// ひとつ上位のノードにフォーカスを移して再検索
			curNode = parentItem;
		}
	},
 
	getPrevDocShell : function(aNode) 
	{
		aNode.QueryInterface(nsIDocShellTreeItem);
		var curNode = aNode;
		var curItem = curNode.QueryInterface(Ci.nsIDocShellTreeItem);
		// このノードが最上位（一番最初）である場合、検索終了
		var parentNode;
		var parentItem = curItem.sameTypeParent;
		if (!parentItem) return null;

		// previousSiblingに相当するノードが無い場合、
		// parentNodeに相当するノードを返す
		var childOffset = this.getChildOffsetFromDocShellNode(curNode);
		if (childOffset < 0) return null;
		if (!childOffset) return parentItem;

		// previousSiblingに相当するノードが子を持っている場合、
		// 最後の子を返す。
		// 子が無ければ、previousSiblingに相当するノードそれ自体を返す。
		parentNode = parentItem.QueryInterface(nsIDocShellTreeItem);
		curItem = parentNode.getChildAt(childOffset-1);
		return this.getLastChildDocShell(curItem) || curItem;
	},
 
	getChildOffsetFromDocShellNode : function(aNode) 
	{
		aNode.QueryInterface(Ci.nsIDocShellTreeItem);
		var parent = aNode.sameTypeParent;
		if (!parent) return -1;

		// nextSiblingに相当するノードを取得して返す
		parent.QueryInterface(nsIDocShellTreeItem);
		var childOffset = 0;
		while (parent.getChildAt(childOffset) != aNode)
		{
			childOffset++;
		}
		return childOffset;
	},
 
	getLastChildDocShell : function(aItem) 
	{
		var curItem = aItem.QueryInterface(Ci.nsIDocShellTreeItem);
		var curNode;
		var childCount;
		while (true)
		{
			curNode = curItem.QueryInterface(nsIDocShellTreeItem);
			childCount = curNode.childCount;
			if (!childCount)
				return (curItem == aItem) ? null : curItem ;
			curItem = curNode.getChildAt(childCount-1);
		}
	},
  
	get isFindable() 
	{
		var doc = this.document;
		switch (doc.documentElement.namespaceURI)
		{
			case 'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul':
			case 'http://www.w3.org/2000/svg':
				return false;

			default:
				return true;
		}
	},
 
	isRangeTopLevel : function(aRange) 
	{
		var body = this.getDocumentBody(this.initialDocument);
		return this.mFromBack ?
			(aRange.startContainer == body) :
			(aRange.endContainer == body) ;
	},
 
	destroy : function() 
	{
		delete this.mCurrentDocShell;
		delete this.mInitialDocShell;
		delete this.mFromBack;
		delete this.mAllowWrap;
		delete this.wrapped;
	}
 
}; 
 
function mydump(aString) 
{
	if (DEBUG)
		dump((aString.length > 1024 ? aString.substring(0, 1024) : aString )+'\n');
}
 
