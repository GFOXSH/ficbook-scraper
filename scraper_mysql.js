'use strict';
const request = require('request-promise');
const promise = require('bluebird');
const cheerio = require('cheerio');
const tress = require('tress');

var mysql = require('promise-mysql');
var connection;
console.log('ficbook.net scraper started');
mysql.createConnection({
    host     : 'localhost',
    user     : 'root',
    password : 'vjybnjh77',
    database : 'sysadm'
}).then(function(conn){
    console.log('02');
    connection = conn;
    q.push({url: 'https://ficbook.net/collections/' + process.argv[2] + '/list', type: 'getCollectList'});
}).catch(function(error){
    //logs out the error
    console.log(error);
    connection.end();
});
console.log('04');

function collectListToDB(collect){
	//Записываем список авторов
	var authors = collect.map(function(item){return [item.authorId, item.authorName]});
    return connection.query('REPLACE INTO authors (idauthor,name) values ?', [authors]).then(function(){
        //Записываем список коллекций
    	var collections = collect.map(function(item){return [item.id, item.name, item.authorId, item.cnt]});
        return connection.query('REPLACE INTO collections (idcollection,name,idauthor,cnt ) values ?', [collections]);
	}).then(function(){
        //Коммит
		return connection.query('commit');
    });
}

Object.defineProperty(global, '__stack', {
	get: function(){
		var orig = Error.prepareStackTrace;
		Error.prepareStackTrace = function(_, stack){ return stack; };
		var err = new Error;
		Error.captureStackTrace(err, arguments.callee);
		var stack = err.stack;
		Error.prepareStackTrace = orig;
		return stack;
	}
});

Object.defineProperty(global, '__line', {
	get: function(){
		return __stack[1].getLineNumber();
	}
});

function logerr(err){
    if (!!err){
        console.log(err);
		//console.log(__stack);
    };
}


function safeGet(match, index) {
    if (Array.isArray(match) && match.length > index &&
        typeof match[2] === 'string' && match[2].length > 0) {
        return match[index];
    }
    else {
        return null;
    }
};

function collectDataToDB(collect, collectId) {
    console.log('collectDataToDB '+collectId);
    return connection.query('DELETE FROM books_collections where idcollection = ?', [collectId]).then(function(){
        var authors = collect.map(function(item){return [item.authorId, item.authorName]});
        return connection.query('INSERT IGNORE INTO authors (idauthor,name) values ?', [authors]);
    }).then(function(){
        var books = collect.map(function(item){return [item.id, item.name, item.authorId, item.card]});
        //return connection.query('INSERT IGNORE INTO books (idbook,name,idauthor,card ) values ?', [books]);
		return promise.all(books.map(function(item){
            return connection.query('INSERT IGNORE INTO books (idbook,name,idauthor,card ) values ?', [[item]]);
		}));
    }).then(function(){
        var books_collections = collect.map(function(item){return [collectId, item.id]});
        return connection.query('INSERT IGNORE INTO books_collections ( idcollection,idbook ) values ?', [books_collections]);
    }).then(function(){
        //Коммит
        return connection.query('commit');
    });
};

function getCollectList(url){
    return request({url: url})
    .then(function (body) {
    	console.log(url + ' loaded')
        const $=cheerio.load(body);
        var list = $('div.collection-thumb');  //collection-thumb js-item-wrapper
        var results = [];
        for(var item = list.first();item.length>0;item=item.next()){
        	var result={};
        	result.name = item.children('div.collection-thumb-info').children('a').text();
        	if (!result.name){
        		continue;
        	}
        	result.url = item.children('div.collection-thumb-info').children('a').attr('href');
        	result.id = parseFloat(result.url.match(/(\d+)/)[1]);
        	var p = item.children('div.collection-thumb-info').contents();
        	//result.cnt = [];
        	p.each(function (i, tag){ 
        		if (typeof tag.data === 'string') {
	        		var re=tag.data.match(/\((\d+)\)/);
	        		if (Array.isArray(re)){
	        		  result.cnt=parseFloat(re[1]);
	        		  return false;
	        		}         		
        		}
        	});
        	result.authorName = item.children('div.collection-thumb-author').children('a').text();
        	result.authorUrl = item.children('div.collection-thumb-author').children('a').attr('href');
        	result.authorId = parseFloat(result.authorUrl.match(/(\d+)/)[1]);
        	//result.cnt = item.children('div.collection-thumb-info')[0];
        	//nextSibling
        	results.push(result);
        };
        //return promise.resolve(results);
        return results;
    })
}

function getCollectData(url,results){
	return request({url: url})
	.then(function (body) {
		console.log(url + ' loaded')
	        const $=cheerio.load(body);
            $._options.decodeEntities = false;
            if (!Array.isArray(results)){
	        	results = [];
	        };
	        var list = $('section.fanfic-thumb-block')
	        for(var tag = list.first();tag.length>0;tag=tag.next()){
	        	var item = tag.find('div.description');
	        	var result = {};
	        	result.name = item.children('h3').children('a').text();
	        	result.url = item.children('h3').children('a').attr('href');
	        	if (!result.url) {
	        	  continue;
	        	}
	        	result.id = parseFloat(result.url.match(/(\d+)/)[1]);
	        	if (result.id !==result.id) {
	        	  console.log(result);
	        	  continue;
	        	}

	        	result.authorName = item.children('ul').children('li').children('a').text().replace(/\n/g,'');
	        	result.authorUrl = item.children('ul').children('li').children('a').attr('href');
	        	result.authorId = parseFloat(result.authorUrl.match(/(\d+)/)[1]);
				result.card = tag.html();
	        	results.push(result);
	        };
	        var newUrl=$('.pagination');
	        newUrl=newUrl.find('i.icon-arrow-right').parent();
	        newUrl=newUrl.attr('href');
	        if (!!newUrl && !!newUrl.match(/collection.*p=\d+/)){		
		        return getCollectData('https://ficbook.net'+newUrl,results);
		} else {
		        return results;
		}
	})
}

function getCollectionCount(idCollection) {
	return connection.query('select count(bc.idbook) as cnt from books_collections bc where bc.idcollection = ?', [idCollection]).then(function(rows,p2,p3){
		return rows[0].cnt;
	})
};

function processJob(job, done){
	if (job.type==='getCollectList') {
		getCollectList(job.url).then(function(result){
			console.log(job.url+' parced');
			result.map(function(item,i){q.push({url:'https://ficbook.net'+item.url,item:item,type:'getCollectData',index:i});})
			q.unshift({result:result,type:'collectListToDB'});
			console.log('Job '+job.type+' finished');
			done(null);
		});
	};
	if (job.type==='getCollectData') {
		getCollectionCount(job.item.id).then(function(result){
			if (result === job.item.cnt){
				console.log('Collection '+ job.item.name + ' ('+ job.item.id +') already loaded');
				done(null);
			} else {
				getCollectData(job.url).then(function(result){
					console.log(job.url+' parced '+job.index);
					q.unshift({result:result,id:job.item.id,type:'collectDataToDB'});
					console.log('Job '+job.type+' finished');
					done(null);
				});
			}
		})
	};
	if (job.type==='collectListToDB') {
		collectListToDB(job.result).then(function(){console.log('Job '+job.type+' finished');done(null)}).catch(function(){
            done(null);
		});
	}
	if (job.type==='collectDataToDB') {
		collectDataToDB(job.result, job.id).then(function(){console.log('Job '+job.type+' finished');done(null)}).catch(function(){
            done(null);
        });
	}
};

// create a queue object with worker and concurrency 1
var q = tress(processJob, 5);

q.drain = function(){
    console.log('db close');
    connection.end();
	console.log('All finished');
};
/*
	if (process.argv[2]) {
		console.log('https://ficbook.net/collections/' + process.argv[2] + '/list');
		q.push({url: 'https://ficbook.net/collections/' + process.argv[2] + '/list', type: 'getCollectList'});
	} else {

console.log('https://ficbook.net/collections/' + process.env.MORPH_START_ID + '/list');
q.push({url: 'https://ficbook.net/collections/' + process.env.MORPH_START_ID + '/list', type: 'getCollectList'});

}
	*/

