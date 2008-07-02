var XMigemoPlaces = { 
	 
	get db() 
	{
		if (this._db !== void(0))
			return this._db;

		this._db = null;

		const DirectoryService = Components
			.classes['@mozilla.org/file/directory_service;1']
			.getService(Components.interfaces.nsIProperties);
		var file = DirectoryService.get('ProfD', Components.interfaces.nsIFile);
		file.append('places.sqlite');
		if (file.exists()) {
			const StorageService = Components
				.classes['@mozilla.org/storage/service;1']
				.getService(Components.interfaces.mozIStorageService);
			this._db = StorageService.openDatabase(file);
		}

		return this._db;
	},
//	_db : null,
	
	get placesSource() 
	{
		if (!this.db) return '';

		var statement = this.db.createStatement(<![CDATA[
		    SELECT GROUP_CONCAT(p.title, ?1),
		           GROUP_CONCAT(p.url, ?1),
		           GROUP_CONCAT(b.title, ?1)
		      FROM moz_places p
		           LEFT JOIN moz_bookmarks b ON b.fk = p.id
		     WHERE p.hidden <> 1 AND p.frecency <> 0
		  ]]>.toString());
		statement.bindStringParameter(0, '\n');

		var sources = [];
		while(statement.executeStep())
		{
			sources.push(statement.getString(0));
			sources.push(statement.getString(1));
			sources.push(statement.getString(2));
		};
		statement.reset();

		sources.push(PlacesUtils.tagging.allTags.join('\n'));

		return sources.join('\n');
	},
 
	get placesSources() 
	{
		if (!this.db) return null;

		var range = XMigemoService.getPref('xulmigemo.places.collectingStep');
		function PlacesSources(aSelf)
		{
			var current = 0;
			var sources;
			while (true)
			{
				sources = aSelf.getPlacesSourceInRange(current, range);
				if (sources)
					yield sources;
				else
					break;
				current += range;
			}
		}

		return PlacesSources(this);
	},
 
	getPlacesSourceInRange : function(aStart, aRange) 
	{
		if (!this.db) return '';

		aStart = Math.max(0, aStart);
		aRange = Math.max(0, aRange);
		if (!aRange) return '';

		var statement = this.db.createStatement(this.placesSourceInRangeSQL);
		statement.bindStringParameter(0, '\n');
		statement.bindDoubleParameter(1, aStart);
		statement.bindDoubleParameter(2, aRange);

		var sources = [];
		if (aStart == 0) sources.push(PlacesUtils.tagging.allTags.join('\n'));
		while(statement.executeStep())
		{
			sources.push(statement.getString(0));
			sources.push(statement.getString(1));
			sources.push(statement.getString(2));
		};
		statement.reset();
		return sources.join('\n').replace(/^\s+|\s+$/g, '');
	},
	placesSourceInRangeSQL : <![CDATA[
		SELECT GROUP_CONCAT(title, ?1),
		       GROUP_CONCAT(uri, ?1),
		       GROUP_CONCAT(bookmark, ?1)
		  FROM (SELECT p.title title,
		               p.url uri,
		               b.title bookmark
		          FROM moz_places p
		          LEFT JOIN moz_bookmarks b ON b.fk = p.id
		         WHERE p.hidden <> 1 AND p.frecency <> 0
		         LIMIT ?2,?3)
	]]>.toString(),
 
	get historySource() 
	{
		if (!this.db) return '';

		var statement = this.db.createStatement(<![CDATA[
		    SELECT GROUP_CONCAT(title, ?1),
		           GROUP_CONCAT(url, ?1)
		      FROM moz_places
		     WHERE hidden <> 1
		  ]]>.toString());
		statement.bindStringParameter(0, '\n');

		var sources = [];
		while(statement.executeStep())
		{
			sources.push(statement.getString(0));
			sources.push(statement.getString(1));
		};
		statement.reset();

		sources.push(PlacesUtils.tagging.allTags.join('\n'));
		return sources.join('\n');
	},
 
	get bookmarksSource() 
	{
		if (!this.db) return '';

		var statement = this.db.createStatement(<![CDATA[
		    SELECT GROUP_CONCAT(b.title, ?1),
		           GROUP_CONCAT(p.url, ?1)
		      FROM moz_bookmarks b
		           LEFT JOIN moz_places p ON b.fk = p.id
		  ]]>.toString());
		statement.bindStringParameter(0, '\n');

		var sources = [];
		while(statement.executeStep())
		{
			sources.push(statement.getString(0));
			sources.push(statement.getString(1));
		};
		statement.reset();

		sources.push(PlacesUtils.tagging.allTags.join('\n'));
		return sources.join('\n');
	},
  
	getFrecencyFromURI : function(aURI) 
	{
		if (!this.db) return 0;

		var statement = this.db.createStatement(<![CDATA[
		    SELECT frecency
		      FROM moz_places
		     WHERE url = ?1
		  ]]>.toString());
		statement.bindStringParameter(0, aURI);
		var frecency = 0;
		while(statement.executeStep())
		{
			frecency = statement.getDouble(0);
		};
		statement.reset();
		return frecency;
	},
 
	expandNavHistoryQuery : function(aQuery, aSource) 
	{
		var terms = XMigemoCore.getTermsForInputFromSource(
				aQuery.searchTerms,
				aSource,
				XMigemoService.getPref('xulmigemo.places.splitByWhiteSpaces')
			);
		var queries = [];
		if (terms.length) {
			queries = queries
				.concat(terms.map(function(aTerm) {
					var newQuery = aQuery.clone();
					newQuery.searchTerms = aTerm;
					return newQuery;
				}));
		}
		else {
			queries.push(aQuery);
		}
		return queries;
	},
 
	findLocationBarItemsFromTerms : function(aTerms, aStart, aRange) 
	{
		var items = [];
		if (!aTerms.length) return items;

		aTerms = aTerms.slice(0, Math.min(100, aTerms.length));
		// see nsNavHistoryAytoComplete.cpp
		var sql = this.locationBarItemsSQL
			.replace(
				'%TERMS_RULES%',
				aTerms.map(function(aTerm, aIndex) {
					return ('title LIKE ?%d% OR bookmark LIKE ?%d% OR '+
							'url LIKE ?%d% OR tags LIKE ?%d%')
							.replace(/%d%/g, aIndex+2);
				}).join(' OR ')
			)
			.replace(
				'%EXCLUDE_JAVASCRIPT%',
				XMigemoService.getPref('browser.urlbar.filter.javascript') ?
					'url NOT LIKE "javascript:%"' :
					'1'
			)
			.replace(
				'%ONLY_TYPED%',
				XMigemoService.getPref('browser.urlbar.matchOnlyTyped') ?
					'typed = 1' :
					'1'
			);

		if (aStart !== void(0)) {
			aRange = Math.max(0, aRange);
			if (!aRange) return items;
			sql = sql.replace(
				'%SOURCES_LIMIT_PART%',
				'LIMIT ?'+(aTerms.length+2)+',?'+(aTerms.length+3)
			);
		}
		else {
			sql = sql.replace('%SOURCES_LIMIT_PART%', '');
		}


		var statement;
		try {
			statement = this.db.createStatement(sql);
		}
		catch(e) {
			dump(e+'\n'+sql+'\n');
			return items;
		}
		try {
			statement.bindDoubleParameter(0, XMigemoService.getPref('browser.urlbar.maxRichResults'));
			aTerms.forEach(function(aTerm, aIndex) {
				statement.bindStringParameter(aIndex+1, '%'+aTerm+'%');
			});
			if (aStart !== void(0)) {
				statement.bindDoubleParameter(aTerms.length+1, Math.max(0, aStart));
				statement.bindDoubleParameter(aTerms.length+2, Math.max(0, aRange));
			}
			aTerms = aTerms.join(' ');
			var item, title;
			while(statement.executeStep())
			{
				item = {
					title : (statement.getIsNull(0) ? '' : statement.getString(0) ),
					uri   : statement.getString(1),
					icon  : (statement.getIsNull(2) ? '' : statement.getString(2) ),
					tags  : (statement.getIsNull(4) ? '' : statement.getString(4) ),
					style : 'favicon',
					terms : aTerms
				};
				if (title = (statement.getIsNull(3) ? '' : statement.getString(3) )) {
					item.title = title;
					item.style = 'bookmark';
				}
				if (item.tags) {
					item.style = 'tag';
				}
				items.push(item);
			};
		}
		finally {
			statement.reset();
		}
		return items;
	},
	 
	locationBarItemsSQL : <![CDATA[ 
		SELECT title, url, favicon, bookmark, tags
		  FROM (SELECT p.title title,
		               p.url url,
		               f.url favicon,
		               p.frecency frecency,
		               p.typed typed,
		               (SELECT b.parent
		                  FROM moz_bookmarks b
		                       JOIN moz_bookmarks t
		                       ON t.id = b.parent
		                       AND t.parent != (SELECT folder_id
		                                          FROM moz_bookmarks_roots
		                                         WHERE root_name = 'tags')
		                 WHERE b.type = 1 AND b.fk = p.id
		                 ORDER BY b.lastModified DESC LIMIT 1) parent,
		               (SELECT b.title
		                  FROM moz_bookmarks b
		                       JOIN moz_bookmarks t
		                       ON t.id = b.parent
		                       AND t.parent != (SELECT folder_id
		                                          FROM moz_bookmarks_roots
		                                         WHERE root_name = 'tags')
		                 WHERE b.type = 1 AND b.fk = p.id
		                 ORDER BY b.lastModified DESC LIMIT 1) bookmark,
		               (SELECT GROUP_CONCAT(t.title, ',')
		                  FROM moz_bookmarks b
		                       JOIN moz_bookmarks t
		                       ON t.id = b.parent
		                       AND t.parent = (SELECT folder_id
		                                         FROM moz_bookmarks_roots
		                                        WHERE root_name = 'tags')
		                 WHERE b.type = 1 AND b.fk = p.id) tags
		          FROM moz_places p
		               LEFT OUTER JOIN moz_favicons f ON f.id = p.favicon_id
		         WHERE p.frecency <> 0 AND p.hidden <> 1
		         %SOURCES_LIMIT_PART%)
		 WHERE (%TERMS_RULES%)
		       AND %EXCLUDE_JAVASCRIPT%
		       AND %ONLY_TYPED%
		 ORDER BY frecency DESC
		 LIMIT 0,?1
	]]>.toString()
 	 
}; 
  
