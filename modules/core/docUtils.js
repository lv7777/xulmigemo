var EXPORTED_SYMBOLS = ['MigemoDocumentUtils'];

var TEST = false; 
var Cc = Components.classes;
var Ci = Components.interfaces;
var Cu = Components.utils;

Cu.import('resource://gre/modules/Services.jsm');

Cu.import('resource://xulmigemo-modules/log.jsm');
function log(...aArgs) { MigemoLog('docUtils', ...aArgs); }

var MigemoDocumentUtils = {
	// frames
	getDocShellFromDocument : function(aDocument)
	{
		return aDocument.defaultView
			.QueryInterface(Ci.nsIInterfaceRequestor)
			.getInterface(Ci.nsIWebNavigation)
			.QueryInterface(Ci.nsIDocShell);
	},

	getOwnerFrameFromContentDocument : function(aDocument)
	{
		let parent = this.getDocShellFromDocument(aDocument)
						.QueryInterface(Ci.nsIDocShellTreeItem)
						.sameTypeParent;
		if (!parent)
			return null;

		var parentDoc = this.getDocumentFromDocShell(parent);
		var frame = null;
		while (frame = this.getNextFrame(parentDoc, frame))
		{
			if (frame.contentDocument == aDocument)
				return frame;
		}

		return null;
	},

	FRAME_CONDITION : '[contains(" IFRAME iframe FRAME frame ", concat(" ", local-name(), " "))]',

	getNextFrame : function(aDocument, aBase) 
	{
		var contextNode = aBase || this.getDocumentBody(aDocument);
		try {
			var xpathResult = aDocument.evaluate(
					'following::*' + this.FRAME_CONDITION + ' | descendant::*' + this.FRAME_CONDITION,
					contextNode,
					null,
					Ci.nsIDOMXPathResult.FIRST_ORDERED_NODE_TYPE,
					null
				);
			var frame = xpathResult.singleNodeValue;
			if (!frame)
				return null;

			if (aBase instanceof Ci.nsIDOMRange) {
				let foundRange = aDocument.createRange();
				foundRange.selectNode(frame);
				if (aBase.compareBoundaryPoints(aBase.START_TO_START, foundRange) > 0)
					return this.getNextFrame(aDocument, frame);
			}

			if (!this.isFindableDocument(frame.contentDocument))
				return this.getNextFrame(aDocument, frame);

			return frame;
		}
		catch(e) {
		}
		return null;
	},

	getPreviousFrame : function(aDocument, aBase) 
	{
		var contextNode = aBase ||
							(function getLast(aParent) {
								return getLast(aParent.lastChild) || aParent;
							})(this.getDocumentBody(aDocument));
		try {
			var xpathResult = aDocument.evaluate(
					'preceding::*' + this.FRAME_CONDITION + ' | ancestor::*' + this.FRAME_CONDITION,
					contextNode,
					null,
					Ci.nsIDOMXPathResult.FIRST_ORDERED_NODE_TYPE,
					null
				);
			var frame = xpathResult.singleNodeValue;
			if (!frame)
				return null;

			if (aBase instanceof Ci.nsIDOMRange) {
				let foundRange = aDocument.createRange();
				foundRange.selectNode(frame);
				if (aBase.compareBoundaryPoints(aBase.END_TO_END, foundRange) < 0)
					return this.getPreviousFrame(aDocument, frame);
			}

			if (!this.isFindableDocument(frame.contentDocument))
				return this.getPreviousFrame(aDocument, frame);

			return frame;
		}
		catch(e) {
		}
		return null;
	},

	isFindableDocument : function(aDocument) 
	{
		switch (aDocument.documentElement.namespaceURI)
		{
			case 'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul':
			case 'http://www.w3.org/2000/svg':
				return false;

			default:
				return (
					aDocument.defaultView.innerWidth > 0 &&
					aDocument.defaultView.innerHeight > 0
				);
		}
	},

	getDocumentFromDocShell : function(aDocShell)
	{
		return aDocShell
			.QueryInterface(Ci.nsIDocShell)
			.QueryInterface(Ci.nsIWebNavigation)
			.document;
	},

	// ranges
	getOwnerDocumentFromRange : function(aRange)
	{
		return aRange.startContainer.ownerDocument || aRange.startContainer;
	},

	// elements
	getDocumentBody : function(aDocument)
	{
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
		return aDocument.documentElement;
	},

	getParentEditableFromRange : function(aRange)
	{
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
	}
};