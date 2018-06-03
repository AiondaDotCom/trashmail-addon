"use strict";

Raven.config('https://f70e8fb95ab7485884ca24a4623dd57d@sentry.io/265192').install();

// http://www.totallystupid.com/?what=3
const PREFIXES = ["abs","aby","ace","act","add","ado","ads","aft","age","ago","aid","ail","aim","air","ait","ale","all","amp","and","ant","any","ape","apt","arc","are","ark","arm","art","ash","ask","asp","ate","auk","awe","awl","awn","axe","azo","baa","bad","bag","bah","bam","ban","bar","bat","bay","bed","bee","beg","bet","bey","bib","bid","big","bin","bio","bit","boa","bob","bod","bog","boo","bop","bot","bow","box","boy","bra","bro","bub","bud","bug","bum","bun","bus","but","buy","bye","cab","cad","cam","can","cap","car","cat","caw","cee","cha","chi","cob","cod","cog","con","coo","cop","cot","cow","cox","coy","cry","cub","cud","cue","cup","cur","cut","dab","dad","dag","dam","day","dee","den","dew","dib","did","die","dig","dim","din","dip","doe","dog","don","doo","dop","dot","dry","dub","dud","due","dug","duh","dun","duo","dux","dye","ear","eat","ebb","eel","egg","ego","eke","elf","elk","elm","emo","emu","end","eon","era","erg","err","eve","ewe","eye","fab","fad","fag","fan","far","far","fat","fax","fay","fed","fee","fen","few","fey","fez","fib","fie","fig","fin","fir","fit","fix","fly","fob","foe","fog","fon","fop","for","fox","fry","fun","fur","gab","gag","gak","gal","gap","gas","gaw","gay","gee","gel","gem","get","gig","gil","gin","git","gnu","gob","God","goo","got","gum","gun","gut","guy","gym","had","hag","hal","ham","has","hat","hay","hem","hen","her","hew","hex","hey","hid","him","hip","his","hit","hoe","hog","hop","hot","how","hoy","hub","hue","hug","hug","huh","hum","hut","ice","ick","icy","ilk","ill","imp","ink","inn","ion","ire","irk","ism","its","jab","jag","jah","jak","jam","jap","jar","jaw","jay","jem","jet","Jew","jib","jig","job","joe","jog","jon","jot","joy","jug","jus","jut","keg","key","kid","kin","kit","koa","kob","koi","lab","lad","lag","lap","law","lax","lay","lea","led","leg","lei","let","lew","lid","lie","lip","lit","lob","log","loo","lop","lot","low","lug","lux","lye","mac","mad","mag","man","map","mar","mat","maw","max","may","men","met","mic","mid","mit","mix","mob","mod","mog","mom","mon","moo","mop","mow","mud","mug","mum","nab","nag","nap","nay","nee","neo","net","new","nib","nil","nip","nit","nix","nob","nod","nog","nor","not","now","nub","nun","nut","oaf","oak","oar","oat","odd","ode","off","oft","ohm","oil","old","ole","one","opt","orb","ore","our","out","out","ova","owe","owl","own","pac","pad","pal","pan","pap","par","pat","paw","pax","pay","pea","pee","peg","pen","pep","per","pet","pew","pic","pie","pig","pin","pip","pit","pix","ply","pod","pog","poi","poo","pop","pot","pow","pox","pro","pry","pub","pud","pug","pun","pup","pus","put","pyx","qat","qua","quo","rad","rag","ram","ran","rap","rat","raw","ray","red","rib","rid","rig","rim","rip","rob","roc","rod","roe","rot","row","rub","rue","rug","rum","run","rut","rye","sac","sad","sag","sap","sat","saw","sax","say","sea","sec","see","set","sew","sex","she","shy","sic","sim","sin","sip","sir","sis","sit","six","ski","sky","sly","sob","sod","som","son","sop","sot","sow","soy","spa","spy","sty","sub","sue","sum","sun","sun","sup","tab","tad","tag","tam","tan","tap","tar","tat","tax","tea","tee","ten","the","tic","tie","til","tin","tip","tit","toe","toe","tom","ton","too","top","tot","tow","toy","try","tub","tug","tui","tut","two","ugh","uke","ump","urn","use","van","vat","vee","vet","vex","via","vie","vig","vim","voe","vow","wad","wag","wan","war","was","wax","way","web","wed","wee","wen","wet","who","why","wig","win","wit","wiz","woe","wog","wok","won","woo","wow","wry","wye","yak","yam","yap","yaw","yay","yea","yen","yep","yes","yet","yew","yip","you","yow","yum","yup","zag","zap","zed","zee","zen","zig","zip","zit","zoa","zoo"]

function callAPI(data, json=null) {
    var headers = new Headers({"Content-Type": "application/x-www-form-urlencoded"});
    var params = new URLSearchParams(data);
    params.append("lang",  browser.i18n.getUILanguage().substr(0, 2));
    var data = {"method": "POST", "headers": headers, "body": JSON.stringify(json)}

    return fetch("https://trashmail.com/?api=1&" + params.toString(), data).then(function (response) {
        if (response.ok)
            return response.json();

        throw new Error(response.status + " " + response.statusText + " Error occurred.");
    }).then(function (response) {
        let msg = response["message"];
        if (msg === undefined)
            msg = response["msg"];
        if (msg === undefined)
            msg = response["data"];

        if (response["success"])
            return msg;
        else
            throw new Error(msg);
    });
}
