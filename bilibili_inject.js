(function() {
    function check() {
        let bvid = null;
        let cid = null;
        let title = null;

        if (window.__INITIAL_STATE__) {
            bvid = window.__INITIAL_STATE__.bvid;
            cid = window.__INITIAL_STATE__.cid;
            if (window.__INITIAL_STATE__.videoData) {
                title = window.__INITIAL_STATE__.videoData.title;
            }
        }

        if (!bvid || !cid) {
            // Try URL regex
            const match = location.pathname.match(/video\/(BV[a-zA-Z0-9]+)/);
            if (match) {
                bvid = match[1];
            }
        }
        
        if (bvid && !cid && window.__INITIAL_STATE__ && window.__INITIAL_STATE__.cidMap && window.__INITIAL_STATE__.cidMap[bvid]) {
             cid = window.__INITIAL_STATE__.cidMap[bvid].cids[0];
        }

        if (bvid && cid) {
            window.postMessage({
                type: 'BILIBILI_DETECTED',
                bvid: bvid,
                cid: cid,
                title: title
            }, '*');
        }
    }
    
    check();
    
    // Monitor URL changes for SPA
    let lastUrl = location.href;
    setInterval(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            check();
        }
    }, 2000);
})();