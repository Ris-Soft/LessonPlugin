// 处理同源插件移除

// 错误名称更正
if (config.getItem("ext").playerMode != null) {
    const extData = config.getItem("ext");
    delete extData.playerMode;
    config.setItem("ext", extData);
    location.reload();
}

// 旧版歌词模式移除
if (config.getItem("ext").lyricsMode != null) {
    const extData = config.getItem("ext");
    delete extData.lyricsMode;
    config.setItem("ext", extData);
    location.reload();
}

const playerSettings = [
    {
        type: 'title',
        text: '⌈设置⌋ 页面更改更多设置'
    },
    {
        name: 'playerSetting_backgroundMode',
        type: 'select',
        label: '背景类型',
        options: [
            [3, '流动光影'],
            [0, '封面模糊'],
            [1, '动态混色'],
            [2, '封面混色']
        ],
        default: 0
    },
    {
        name: 'playerSetting_blurEffect',
        type: 'input',
        label: '背景模糊程度',
        inputType: 'number',
        dependency: 'playerSetting_backgroundMode',
        dependencyValue: ["0", "3"],
        default: 70
    },
    {
        name: 'playerSetting_darknessEffect',
        type: 'input',
        label: '背景阴暗程度',
        inputType: 'number',
        dependency: 'playerSetting_backgroundMode',
        dependencyValue: ["0", "3"],
        default: 0.6
    },
    {
        name: 'ext.playerPage.lyricMode',
        type: 'switch',
        label: '歌词纯享模式',
        default: false
    },
    {
        name: 'lyricBlur',
        type: 'switch',
        label: '歌词层级虚化',
        default: true
    },
    {
        name: 'ext.playerPage.autoHideBottom',
        type: 'switch',
        label: '自动隐藏底栏',
        default: false
    },
    {
        name: '3dEffect',
        type: 'switch',
        label: '页面立体特效',
        default: false
    }
];

playerSettings.forEach(setting => {
    defaultConfig[setting.name] = setting.default;
});

var lyricsModeCSS = `
.controls {
    position: absolute;
    margin-bottom: 0;
    width: 100%;
}
.controls #album {
    display: none;
}
.lyrics,.list {
    width: 100%;
    left: 0;
}

body:not(.hideLyrics.hideList) .playerContainer {
    transform: translateX(0px);
}

.hideLyrics.hideList .controls {
    margin: auto;
    width: 350px;
}

.SimLRC {
    --align: center !important;
}

.lyrics, .list {
    height: 82.5vh;
    margin-top: 6vh;
}

.infoBar {
    display: none;
}

.line-container {
    align-items: center !important;
}

.infoBar .musicInfo {
    display: none;
}

.WBWline,.active-dots {
    justify-content: center !important;
}
`;

var style = `
.playerContainer {
    margin: 20px max(calc(50vw - 700px), 110px);
}

#playPage {
    background: black;
}

.controls,.hideLyrics.hideList .controls {
    width: calc(100vw* 0.4);
    margin: auto 0 15% 0;
}

.controls #album {
    width: calc(100vw* 0.20);
}

.controls .infoBar {
    margin: 30px 0 10px 0;
}

.controls .musicInfo b {
    font-size: 3.0em;
    white-space: break-spaces;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
    text-overflow: ellipsis;
}

.controls .musicInfo div {
    margin-top: 20px;
}

.lyrics , .list {
    left: calc(100vw* 0.45);
    width: calc(100vw* 0.4);
    height: calc(100% - 60px);
}

.controls .buttons {
    position: fixed;
    bottom: -10px;
    left: -8%;
    width: 100vw;
    display: none;
}

.darkPlayer #playPage .SimProgress {
    position: fixed;
    bottom: 60px;
    left: -65px;
    width: 100vw;
}

.bottom > .center > #ExPlayerMenuBtn{
    display: none;
} 

.bottom > .center > #ExPlayerLyricsBtn{
    display: none;
}

.playerShown > .bottom {
    bottom: 0;
    background: transparent;
    z-index: 100;
    color: var(--SimAPTheme);
    transition: all .3s;
}

.playerShown > .bottom > .progressBefore {
    display: none;
}

.playerShown > .bottom > .progressAfter {
    display: none;
}

.playerShown > .bottom > .info {
    display: none;
}

.playerShown .SimProgress {
    opacity: 0.6;
}

.playerShown .SimProgress::hover {
    opacity: 1;
}

.playerShown .SimProgress>div>div {
    background: var(--SimAPTheme) !important;
}

.playerShown .SimProgress:not(.readOnly)::after {
    background: var(--SimAPTheme) !important;
    display: none;
}

.playerShown .SimProgress:not(.readOnly):hover::after {
    background: var(--SimAPTheme) !important;
    display: none;
}

.bottom > .center > #ExPlayerMenuBtn{
    display: none;
} 

.playerShown > .bottom > .center > #ExPlayerMenuBtn{
    display: block;
} 

.playerShown > .bottom > .center > #ExPlayerLyricsBtn{
    display: block;
} 

.playerShown > .bottom > .center> .play {
    font-size: 1.8em;
    margin-top: 0:
}

.playerShown > .bottom > .center.hidden > div:not(.ignoreHide),.playerShown > .bottom > .volume.hidden > div:not(.ignoreHide) {
    opacity: 0;
}

.playerShown > .bottom > .volBtnBottom {
    top: 0;
}

#ExPlayerPlayTime {
    color: unset;
}

.playerShown > #ExPlayerPlayTime {
    color: white;
}

.controls .progressControl {
    display: none;
}

.controls .infoBar i {
    display: none;
}

#background {
    display: none;
}

.ExPlayerBtn {
    font-size: 1.6em;
    transition: all .3s;
    opacity: .3;
    color: var(--SimAPTheme);
    z-index: 9999;
    -webkit-app-region: no-drag;
}

.ExPlayerBtn:hover {
    opacity: .8;
}

.ExPlayerBtn:active {
    opacity: .8;
    transform: scale(0.9);
}

#playerSet .block {
    margin-bottom: 10px;
    background: rgba(255, 255, 255, .1);
    padding: 5px;
    border-radius: 5px;
}
`;

let backgroundRule = document.createElement('style');
backgroundRule.id = 'ExPlayerPageBg';
document.head.appendChild(backgroundRule);

let albumObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        if (mutation.attributeName === 'src') {
            let albumSrc = document.querySelector('.controls #album')?.src;
            setBackground(albumSrc);
        }
    });
});

let fullscreenObserver = new MutationObserver(() => {
    let isFullscreen = document.body.classList.contains("fullscreen");
    let fullToggleBtn = document.querySelector('#ExPlayerFulldBtn');
    let setBtn = document.querySelector('#ExPlayerSetBtn');
    let setMenu = document.querySelector('#playerSet');
    if (fullToggleBtn) {
        document.querySelector('#ExPlayerFoldBtn').style.display = isFullscreen ? 'none' : 'block';
        fullToggleBtn.style.left = isFullscreen ? '30px' : '80px';
    }
    if (setBtn) {
        setBtn.style.top = isFullscreen ? '30px' : '44px';
    }
    if (setMenu) {
        setMenu.style.top = isFullscreen ? '22px' : '36px';
    }
});

let progressObserver = new MutationObserver(() => {
    let currentTime = document.querySelector('#progressCurrent')?.innerHTML;
    let totalTime = document.querySelector('#progressDuration')?.innerHTML;
    let playTimeElement = document.querySelector('#ExPlayerPlayTime');
    if (playTimeElement) {
        playTimeElement.innerHTML = `${currentTime} / ${totalTime}`;
    }
})

let lMNObserver = new MutationObserver(() => {
    let lmSongNameElement = document.querySelector('#ExPlayerLmSongName');
    if (config.getItem("ext.playerPage.lyricMode") == false) {
        if (lmSongNameElement) {
            lmSongNameElement.style.display = 'none';
        }
        return;
    };
    let musicFullName = document.querySelector('.musicInfo > div')?.innerHTML + " - " + document.querySelector('.musicInfo > b')?.innerHTML;
    if (lmSongNameElement) {
        lmSongNameElement.style.display = 'block';
        lmSongNameElement.innerHTML = musicFullName;
    }
})

function setBackground(albumSrc) {
    let backgroundMode = config.getItem("playerSetting_backgroundMode");
    if (albumSrc) {
        if (backgroundMode == 0 || backgroundMode == null) {
            document.querySelector('#background').style.display = 'none';
            let blurEffect = config.getItem("playerSetting_blurEffect") ?? 70;
            let darknessEffect = config.getItem("playerSetting_darknessEffect") ?? 0.6;
            backgroundRule.textContent = `
                            #playPage::before {
                                content: '';
                                position: absolute;
                                top: 0;
                                left: 0;
                                width: 100%;
                                height: 100%;
                                background: url(${albumSrc}) center/cover;
                                filter: blur(${blurEffect}px) brightness(${darknessEffect});
                                z-index: -1;
                            }
                        `;
            document.querySelector('#EX_background_fluentShine')?.remove();
        } else if (backgroundMode == 1) {
            config.setItem("backgroundBlur", true);
            document.querySelector('#background').style.display = 'block';
            backgroundRule.textContent = ``;
            document.querySelector('#EX_background_fluentShine')?.remove();
        } else if (backgroundMode == 2) {
            config.setItem("backgroundBlur", false);
            document.querySelector('#background').style.display = 'block';
            backgroundRule.textContent = ``;
            document.querySelector('#EX_background_fluentShine')?.remove();
        } else if (backgroundMode == 3) {
            document.querySelector('#background').style.display = 'none';
            if (document.querySelector('#EX_background_fluentShine')) {
                let blurEffect = config.getItem("playerSetting_blurEffect") ?? 70;
                let darknessEffect = config.getItem("playerSetting_darknessEffect") ?? 0.6;
                backgroundRule.textContent = `
            #EX_background_fluentShine:before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: url(${albumSrc}) center/cover;
                filter: blur(${blurEffect}px) brightness(${darknessEffect});
                z-index: -1;
            }

            .fluentShine::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: url(${albumSrc}) center/cover;
                filter: blur(${blurEffect}px) brightness(${darknessEffect});
                z-index: -1;
            }
            @keyframes rotate-clockwise {
                from {
                    transform: rotate(0deg);
                }
                to {
                    transform: rotate(360deg);
                }
            }
            @keyframes rotate-counterclockwise {
                from {
                    transform: rotate(0deg);
                }
                to {
                    transform: rotate(-360deg);
                }
            }
        `;
            } else {
                let fluentShineContainer = document.createElement('div');
                fluentShineContainer.id = 'EX_background_fluentShine';
                fluentShineContainer.style.display = 'block';
                fluentShineContainer.style.flexWrap = 'wrap';
                fluentShineContainer.style.background = 'url(' + albumSrc + ') center/cover';

                for (let i = 1; i <= 4; i++) {
                    let img = document.createElement('div');
                    img.id = `EX_background_fluentShine${i}`;
                    img.classList.add('fluentShine');
                    img.style.position = 'absolute';
                    img.style.width = '50%';
                    img.style.height = '50%';

                    if (i === 1) {
                        img.style.top = '0';
                        img.style.left = '0';
                    } else if (i === 2) {
                        img.style.top = '0';
                        img.style.right = '0';
                    } else if (i === 3) {
                        img.style.bottom = '0';
                        img.style.left = '0';
                    } else if (i === 4) {
                        img.style.bottom = '0';
                        img.style.right = '0';
                    }

                    let rotationDirection = i % 2 === 0 ? 'clockwise' : 'counterclockwise';
                    let rotationSpeed = [15, 12, 18, 14][i - 1] || 14;
                    img.style.animation = `rotate-${rotationDirection} ${rotationSpeed}s linear infinite`;

                    fluentShineContainer.appendChild(img);
                }

                document.querySelector('#playPage')?.appendChild(fluentShineContainer);

                let blurEffect = config.getItem("playerSetting_blurEffect") ?? 70;
                let darknessEffect = config.getItem("playerSetting_darknessEffect") ?? 0.6;
                backgroundRule.textContent = `
            #EX_background_fluentShine:before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: url(${albumSrc}) center/cover;
                filter: blur(${blurEffect}px) brightness(${darknessEffect});
                z-index: -1;
            }

            .fluentShine::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: url(${albumSrc}) center/cover;
                filter: blur(${blurEffect}px) brightness(${darknessEffect});
                z-index: -1;
            }
                
            @keyframes rotate-clockwise {
                from {
                    transform: rotate(0deg);
                }
                to {
                    transform: rotate(360deg);
                }
            }
            @keyframes rotate-counterclockwise {
                from {
                    transform: rotate(0deg);
                }
                to {
                    transform: rotate(-360deg);
                }
            }
        `;
            }
        }
    }
}

const current = document.getElementById("progressCurrent");
const duration = document.getElementById("progressDuration");

function addButton() {

    let lyricsBtn = document.createElement('div');
    lyricsBtn.onclick = () => SimAPControls.toggleLyrics();
    lyricsBtn.style.position = 'fixed';
    lyricsBtn.style.left = '55px';
    lyricsBtn.className = 'large';
    lyricsBtn.id = 'ExPlayerLyricsBtn';
    lyricsBtn.title = '显示歌词';
    let lyricsIcon = document.createElement('i');
    lyricsIcon.innerHTML = '';
    lyricsBtn.appendChild(lyricsIcon);
    document.querySelector('.bottom > .center')?.insertAdjacentElement('afterbegin', lyricsBtn);

    let menuBtn = document.createElement('div');
    menuBtn.onclick = () => PlayerController.showPlayerMenu();
    menuBtn.style.position = 'fixed';
    menuBtn.style.left = '15px';
    menuBtn.className = 'large';
    let menuIcon = document.createElement('i');
    menuIcon.innerHTML = '';
    menuBtn.appendChild(menuIcon);
    menuBtn.id = 'ExPlayerMenuBtn';
    menuBtn.title = '播放器菜单';
    menuBtn.classList.add('ignoreHide');
    menuBtn.visibility = 'visible';
    document.querySelector('.bottom > .center')?.insertAdjacentElement('afterbegin', menuBtn);

    let foldBtn = document.createElement('div');
    foldBtn.onclick = () => SimAPUI.hide();
    foldBtn.style.position = 'absolute';
    foldBtn.style.left = '30px';
    foldBtn.style.top = '30px';
    let foldIcon = document.createElement('i');
    foldIcon.innerHTML = '';
    foldBtn.appendChild(foldIcon);
    foldBtn.className = 'ExPlayerBtn';
    foldBtn.id = 'ExPlayerFoldBtn';
    foldBtn.title = '收起播放页';
    document.querySelector('#playPage')?.insertAdjacentElement('afterbegin', foldBtn);

    let lmSongName = document.createElement('div');
    lmSongName.style.position = 'absolute';
    lmSongName.style.left = '50%';
    lmSongName.style.top = '30px';
    lmSongName.style.transform = 'translateX(-50%)';
    lmSongName.className = 'ExPlayerBtn';
    lmSongName.id = 'ExPlayerLmSongName';
    lmSongName.style.display = 'none';
    lmSongName.style.whiteSpace = 'nowrap';
    lmSongName.style.overflow = 'hidden';
    lmSongName.style.textOverflow = 'ellipsis';
    document.querySelector('#playPage')?.insertAdjacentElement('afterbegin', lmSongName);

    let fullToogleBtn = document.createElement('div');
    fullToogleBtn.onclick = () => {
        SimAPUI.toggleFullScreen();
        fullToogleBtn.firstChild.innerHTML = document.body.classList.contains("fullscreen") ? '' : '';
    };
    let fullToggleIcon = document.createElement('i');
    fullToggleIcon.innerHTML = document.body.classList.contains("fullscreen") ? '' : '';
    fullToogleBtn.appendChild(fullToggleIcon);
    fullToogleBtn.style.position = 'absolute';
    fullToogleBtn.style.left = '80px';
    fullToogleBtn.style.top = '30px';
    fullToogleBtn.className = 'ExPlayerBtn';
    fullToogleBtn.id = 'ExPlayerFulldBtn';
    fullToogleBtn.title = document.body.classList.contains("fullscreen") ? "退出全屏" : "播放页全屏";
    document.querySelector('#playPage')?.insertAdjacentElement('afterbegin', fullToogleBtn);

    let playTime = document.createElement('div');
    playTime.style.position = 'absolute';
    playTime.style.right = '190px';
    playTime.style.top = '34px';
    playTime.className = 'ExPlayerBtn';
    playTime.id = 'ExPlayerPlayTime';
    playTime.style.fontSize = '0.8em';
    playTime.innerHTML = '';
    document.querySelector('.bottom')?.insertAdjacentElement('afterbegin', playTime);

    let setBtn = document.createElement('div');
    setBtn.style.position = 'absolute';
    setBtn.onclick = () => {
        let playerSet = document.querySelector('#playerSet');
        if (playerSet.style.display == 'none') {
            playerSet.style.display = 'block';
            setBtn.style.opacity = '1';
        }
        else {
            playerSet.style.display = 'none';
            setBtn.style.opacity = '.3';
        }
    };
    setBtn.style.right = '30px';
    setBtn.style.top = '44px';
    let setIcon = document.createElement('i');
    setIcon.innerHTML = '';
    setBtn.appendChild(setIcon);
    setBtn.className = 'ExPlayerBtn';
    setBtn.id = 'ExPlayerSetBtn';
    setBtn.title = '播放器设置';
    document.querySelector('#playPage')?.insertAdjacentElement('afterbegin', setBtn);

    let dependency = playerSettings.filter(setting => setting.dependency);

    let playerSet = document.createElement('div');
    playerSet.style.position = 'absolute';
    playerSet.style.display = 'none';
    playerSet.style.width = '220px';
    playerSet.style.top = '36px';
    playerSet.style.background = 'rgba(120,120,120,.2)';
    playerSet.style.height = '360px';
    playerSet.style.right = '20px';
    playerSet.style.zIndex = '1000';
    playerSet.style.padding = '15px';
    playerSet.style.borderRadius = '5px';
    playerSet.style.backdropFilter = 'blur(10px)';
    playerSet.id = 'playerSet';
    playerSet.className = 'playerSet';

    let settingsHtml = '<div style="padding-bottom: 10px; font-size: 1.2em;">播放器设置</div>';
    playerSet.innerHTML = settingsHtml;

    setContaienrr = document.createElement('div');

    function checkDependency() {
        dependency.forEach(dependencySetting => {
            const dependencyValue = (config.getItem(dependencySetting.dependency));
            const dependencyDiv = document.querySelector(`div[data-setting-name="${dependencySetting.name}"]`);
            if (dependencyDiv) {
                if (!dependencySetting.dependencyValue.includes(dependencyValue)) {
                    dependencyDiv.style.display = 'none';
                } else {
                    dependencyDiv.style.display = 'block';
                }
            }
        });
    }

    playerSettings.forEach(setting => {
        const storedValue = config.getItem(`${setting.name}`) ?? setting.default;
        const div = document.createElement('div');
        div.setAttribute('data-setting-name', setting.name);
        div.classList.add('block');

        if (setting.dependency) {
            // console.log(setting.name, setting.dependency, setting.dependencyValue);
            const dependencyValue = (config.getItem(setting.dependency));
            if (!setting.dependencyValue.includes(dependencyValue)) {
                div.style.display = 'none';
            }
        }

        switch (setting.type) {
            case 'title':
                div.classList.add('title');
                div.textContent = setting.text;
                break;

            case 'range':
                div.innerHTML = `${setting.label}<div class="range" min="${setting.min}" max="${setting.max}" value="${storedValue}"></div>`;
                const range = new SimProgress(div.querySelector('.range'));
                range.ondrag = value => {
                    config.setItem(`${setting.name}`, value);
                    checkDependency();
                };
                break;

            case 'switch':
                div.innerHTML = `<label style="display:flex"><span style="flex:1">${setting.label}</span><div class="toggle"></div></label>`;
                div.classList.add(storedValue === true ? 'on' : 'off');
                div.onclick = () => {
                    div.classList.toggle('on');
                    div.classList.toggle('off');
                    const newValue = div.classList.contains('on');
                    config.setItem(`${setting.name}`, newValue);
                    checkDependency();
                };
                break;

            case 'input':
                div.innerHTML = `${setting.label}<br><input style="width:95%;margin:2%;" type="${setting.inputType ?? 'text'}">`;
                const input = div.querySelector('input');
                input.value = storedValue;
                input.autocomplete = input.spellcheck = false;
                input.onchange = () => {
                    config.setItem(`${setting.name}`, input.value);
                    checkDependency();
                };
                break;

            case 'select':
                div.innerHTML = `${setting.label}<br><select style="width:95%;margin:2%;"></select>`;
                const select = div.querySelector('select');
                setting.options.forEach(option => {
                    const optionEle = document.createElement('option');
                    optionEle.value = option[0];
                    optionEle.textContent = option[1];
                    select.appendChild(optionEle);
                });
                select.value = storedValue;
                select.onchange = () => {
                    config.setItem(`${setting.name}`, select.value);
                    checkDependency();
                };
                break;

            case 'color':
                div.innerHTML = `${setting.label}<div class="colorInput"><span></span><input type="color"></div>`;
                const colorInput = div.querySelector('input');
                colorInput.value = storedValue;
                div.querySelector('.colorInput > span').textContent = storedValue;
                div.querySelector('.colorInput > span').style.color = storedValue;
                colorInput.onchange = () => {
                    div.querySelector('.colorInput > span').textContent = colorInput.value;
                    div.querySelector('.colorInput > span').style.color = colorInput.value;
                    config.setItem(`${setting.name}`, colorInput.value);
                    checkDependency();
                };
                break;

            case 'button':
                div.innerHTML = `${setting.label}<button class="sub">${SimMusicTools.escapeHtml(setting.button)}</button>`;
                div.onclick = setting.onclick;
                break;

            default:
                console.warn(`不支持的组件: ${setting.type}`);
                return;
        }
        setContaienrr.appendChild(div);
    });

    setContaienrr.style.overflowY = 'auto';
    setContaienrr.style.maxHeight = '300px';

    playerSet.appendChild(setContaienrr);

    document.querySelector('#playPage')?.insertAdjacentElement('afterbegin', playerSet);
}

function deleteButton() {
    document.querySelector('#ExPlayerMenuBtn')?.remove();
    document.querySelector('#ExPlayerLyricsBtn')?.remove();
    document.querySelector('#ExPlayerFoldBtn')?.remove();
    document.querySelector('#ExPlayerFulldBtn')?.remove();
    document.querySelector('#ExPlayerPlayTime')?.remove();
    document.querySelector('#playerSet')?.remove();
    document.querySelector('#ExPlayerSetBtn')?.remove();
    document.querySelector('#ExPlayerLmSongName')?.remove();
}

let albumElement = document.querySelector('.controls #album');
if (albumElement) {
    albumObserver.observe(albumElement, { attributes: true });
}
let albumSrc = document.querySelector('.controls #album')?.src;
setBackground(albumSrc);

function loadStyles() {
    config.setItem("darkPlayer", true);
    let styles = "";

    document.querySelector("#ExPlayerPage")?.remove();

    if (config.getItem("ext.playerPage.isEffect") == true) {
        if (config.getItem("ext.playerPage.isEffect") == true && config.getItem("darkPlayer") == false) {
            alert("请在设置中启用播放页深色模式以继续使用「播放页面」插件！");
            config.setItem("ext.playerPage.isEffect", false);
        }
        styles = style;
        fullscreenObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
        let progressCurrentElement = document.querySelector('#progressCurrent');
        let progressDurationElement = document.querySelector('#progressDuration');
        if (progressCurrentElement) {
            progressObserver.observe(progressCurrentElement, { childList: true, subtree: true });
        }
        if (progressDurationElement) {
            progressObserver.observe(progressDurationElement, { childList: true, subtree: true });
        }
        if (document.querySelector('.musicInfo > div') && document.querySelector('.musicInfo > b')) {
            lMNObserver.observe(document.querySelector('.musicInfo > div'), { childList: true, subtree: true });
            lMNObserver.observe(document.querySelector('.musicInfo > b'), { childList: true, subtree: true });
        }
        addButton();
        includeStyleElement(styles, "ExPlayerPage");
    } else {
        fullscreenObserver.disconnect();
        progressObserver.disconnect();
        lMNObserver.disconnect();
        document.querySelector("#ExPlayerPage")?.remove();
        deleteButton();
    }

    lyricsMode();

}

function lyricsMode() {
    document.querySelector("#ExPlayerPageLyricsMode")?.remove();
    const llmElement = document.querySelector('#ExPlayerLmSongName');
    if (!llmElement) return;
    if (config.getItem("ext.playerPage.lyricMode") == true) {
        let musicFullName = document.querySelector('.musicInfo > div')?.innerHTML + " - " + document.querySelector('.musicInfo > b')?.innerHTML;
        if (llmElement) {
            llmElement.style.display = 'block';
            llmElement.innerHTML = musicFullName;
        }
        includeStyleElement(lyricsModeCSS, "ExPlayerPageLyricsMode");
    } else {
        if (llmElement) {
            llmElement.style.display = 'none';
        }
        document.querySelector("#ExPlayerPageLyricsMode")?.remove();
    }
}

defaultConfig['ext.playerPage.isEffect'] = true;
defaultConfig['ext.playerPage.autoHideBottom'] = true;
defaultConfig['ext.playerPage.lyricMode'] = false;
defaultConfig['ext.playerPage.autoHideBottom'] = true;
defaultConfig['playerSetting_backgroundMode'] = "0";

SettingsPage.data.push(
    { type: "title", text: "[第三方扩展] 播放页面" },
    { type: "boolean", text: "启用修改的播放页面", description: "开启后将更改播放页面使其更加美观", configItem: "ext.playerPage.isEffect" },
    { type: "boolean", text: "播放页自动隐藏播放控件", description: "开启后在播放页超过3秒无操作则隐藏部分底栏", configItem: "ext.playerPage.autoHideBottom" },
    { type: "boolean", text: "启用歌词纯享模式", description: "歌词居中关闭封面,顶部上侧显示音乐名称", configItem: "ext.playerPage.lyricMode" },
    {
        type: "select",
        text: "播放页面背景类型",
        description: "选择背景类型,该功能会强制覆盖原设置(及时您关闭了修改后播放页面)",
        options: [
            ["3", "流动光影"],
            ["0", "封面模糊 (默认)"],
            ["1", "动态混色"],
            ["2", "封面混色"],
        ],
        configItem: "playerSetting_backgroundMode",
    },
    { type: "button", text: "逐字歌词功能自动启用", description: "逐字歌词暂不支持自行开启/改变", configItem: "ext.playerPage.autoHideBottom" },
);

config.listenChange("ext.playerPage.isEffect", () => loadStyles());
config.listenChange("ext.playerPage.lyricMode", () => lyricsMode());
config.listenChange("darkPlayer", () => {
    setTimeout(() => {
        config.setItem("darkPlayer", true);
    }, 1000);
});

config.listenChange("playerSetting_backgroundMode", () => {
    setBackground(document.querySelector('.controls #album')?.src);
});

config.listenChange("playerSetting_blurEffect", () => {
    applyPlayerSettings();
});

config.listenChange("playerSetting_darknessEffect", () => {
    applyPlayerSettings();
});

function applyPlayerSettings() {
    let blurEffect = config.getItem("playerSetting_blurEffect") ?? 70;
    let darknessEffect = config.getItem("playerSetting_darknessEffect") ?? 0.6;
    let backgroundMode = config.getItem("playerSetting_backgroundMode") ?? 0;
    if (config.getItem("playerSetting_backgroundMode") != (0 || 3)) return;
    if (backgroundMode == 0) {
        backgroundRule.textContent = `
                            #playPage::before {
                                content: '';
                                position: absolute;
                                top: 0;
                                left: 0;
                                width: 100%;
                                height: 100%;
                                background: url(${document.querySelector('.controls #album')?.src}) center/cover;
                                filter: blur(${blurEffect}px) brightness(${darknessEffect});
                                z-index: -1;
                            }
                        `;
    } else if (backgroundMode == 3) {
        backgroundRule.textContent = `
            #EX_background_fluentShine:before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: url(${document.querySelector('.controls #album')?.src}) center/cover;
                filter: blur(${blurEffect}px) brightness(${darknessEffect});
                z-index: -1;
            }

            .fluentShine::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: url(${document.querySelector('.controls #album')?.src}) center/cover;
                filter: blur(${blurEffect}px) brightness(${darknessEffect});
                z-index: -1;
            }
                
            @keyframes rotate-clockwise {
                from {
                    transform: rotate(0deg);
                }
                to {
                    transform: rotate(360deg);
                }
            }
            @keyframes rotate-counterclockwise {
                from {
                    transform: rotate(0deg);
                }
                to {
                    transform: rotate(-360deg);
                }
            }
        `;
    }
}

loadStyles();

// 歌词载入


// 自动隐藏
let inactivityTimer;
const INACTIVITY_THRESHOLD = 3000; // 3秒
function onInactivity() {
    if (!document.body.classList.contains('playerShown')) return;
    document.querySelector('.bottom > .center').style.visibility = 'hidden';
    document.querySelector('.bottom > .volume').style.visibility = 'hidden';
    document.querySelector('#bottomProgressBar').style.top = 'auto';
    document.querySelector('#bottomProgressBar').style.bottom = '0';
    document.querySelector('.bottom > .center > .play').style.visibility = 'visible';
    document.querySelector('.bottom > .center > .play').classList.add('ignoreHide');
    document.querySelector('.bottom > .center > #ExPlayerMenuBtn').style.visibility = 'visible';
    document.querySelector('.bottom > .center').classList.add('hidden');
    document.querySelector('.bottom > .volume').classList.add('hidden');
    document.querySelector('.bottom').style.backdropFilter = 'blur(0px)';
    document.querySelector('#ExPlayerPlayTime').style.right = '30px';
    document.hasInactivity = true;
}
function onActivity() {
    document.querySelector('#bottomProgressBar').style.top = '0';
    document.querySelector('#bottomProgressBar').style.bottom = 'auto';
    document.querySelector('.bottom > .volume').style.visibility = 'visible';
    document.querySelector('.bottom > .center').style.visibility = 'visible';
    document.querySelector('.bottom').style.backdropFilter = 'blur(70px)';
    document.querySelector('.bottom > .center').classList.remove('hidden');
    document.querySelector('.bottom > .volume').classList.remove('hidden');
    document.querySelector('.bottom > .center > #ExPlayerMenuBtn').style.visibility = 'visible';
    document.querySelector('#ExPlayerPlayTime').style.right = '190px';
}
function resetTimer() {
    clearTimeout(inactivityTimer);
    if (config.getItem('ext.playerPage.isEffect') == true) inactivityTimer = setTimeout(onInactivity, INACTIVITY_THRESHOLD);
}
function setupActivityListeners() {
    document.addEventListener('mousemove', handleUserActivity);
    document.addEventListener('mousedown', handleUserActivity);
    document.addEventListener('mouseup', handleUserActivity);
    document.addEventListener('click', handleUserActivity);
    document.addEventListener('wheel', handleUserActivity); // 滚轮事件
}
function handleUserActivity() {
    if (config.getItem('ext.playerPage.autoHideBottom') == false && config.getItem('ext.playerPage.isEffect') == true) {
        onActivity();
        return;
    }
    if (!document.body.classList.contains('playerShown') && config.getItem('ext.playerPage.isEffect') == true) {
        document.hasInactivity = true;
        onActivity();
        return;
    }
    if (document.hasInactivity && config.getItem('ext.playerPage.isEffect') == true) {
        onActivity();
        document.hasInactivity = false;
    }
    resetTimer();
}

document.hasInactivity = false;
resetTimer();
setupActivityListeners();