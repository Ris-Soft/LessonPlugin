const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const resultsDiv = document.getElementById("results");
const audio = document.getElementById("audio");
const audioBar = document.getElementById("audioBar");
const audioCover = document.getElementById("audioCover");
const audioTitle = document.getElementById("audioTitle");
const audioArtist = document.getElementById("audioArtist");
const audioPlayBtn = document.getElementById("audioPlayBtn");
const audioDownloadBtn = document.getElementById("audioDownloadBtn");
const audioTime = document.getElementById("audioTime");
const audioProgressBar = document.getElementById("audioProgressBar");
const audioProgress = document.getElementById("audioProgress");
const audioProgressDot = document.getElementById("audioProgressDot");
const playerModal = document.getElementById("playerModal");
const playerModalMask = document.getElementById("playerModalMask");
const playerModalCover = document.getElementById("playerModalCover");
const playerModalTitle = document.getElementById("playerModalTitle");
const playerModalArtist = document.getElementById("playerModalArtist");
const playerModalHideBtn = document.getElementById("playerModalHideBtn");
const playerModalCloseBtn = document.getElementById("playerModalCloseBtn");
const playerModalPanel = document.getElementById("playerModalPanel");
let currentPlayingId = null;
let tempMetadata = {};
let currentPage = 0;
let currentKeyword = "";
let loading = false;
let hasMore = true;
let currentAudioUrl = "";
let currentSongMeta = null;

async function searchSongs(keyword, page = 0, append = false) {
  if (!append) {
    resultsDiv.innerHTML =
      '<div style="text-align:center;padding:24px;color:#aaa;">搜索中...</div>';
    resultsDiv.style.display = "block";
    document.querySelector(".container").classList.remove("centered");
    currentPage = 0;
    hasMore = true;
  }
  loading = true;
  try {
    const apiUrl = `https://search.kuwo.cn/r.s?all=${encodeURIComponent(
      keyword
    )}&pn=${page}&rn=20&vipver=100&ft=music&encoding=utf8&rformat=json&vermerge=1&mobi=1`;
    const res = await fetch(`proxy.php?url=${encodeURIComponent(apiUrl)}`);
    // const res = await fetch(apiUrl);
    const data = await res.json();
    if (!data.abslist || !data.abslist.length) {
      if (!append)
        resultsDiv.innerHTML =
          '<div style="text-align:center;padding:24px;color:#aaa;">未找到相关歌曲</div>';
      hasMore = false;
      loading = false;
      return;
    }
    tempMetadata = append ? tempMetadata : {};
    if (!append) resultsDiv.innerHTML = "";
    data.abslist.forEach((item) => {
      const id = item.MUSICRID.replace("MUSIC_", "");
      const rawTitle = item.SONGNAME || "";
      const processedTitle = rawTitle.includes("-")
        ? rawTitle.split("-").slice(0, -1).join("-").trim()
        : rawTitle;
      tempMetadata[id] = {
        title: processedTitle,
        artist: item.ARTIST,
        album: item.ALBUM,
        time: item.DURATION,
        cover: item.web_albumpic_short
          ? `https://img3.kuwo.cn/star/albumcover/${item.web_albumpic_short.replace(
            "120/",
            "256/"
          )}`
          : item.web_artistpic_short
            ? `https://star.kuwo.cn/star/starheads/${item.web_artistpic_short.replace(
              "120/",
              "500/"
            )}`
            : "",
      };
      const div = document.createElement("div");
      div.className = "result-item";
      div.dataset.id = id;
      div.innerHTML = `
                    <img class="cover" src="${tempMetadata[id].cover || ""
        }" alt="cover" onerror="this.style.display='none'">
                    <div class="info">
                        <div class="title">${tempMetadata[id].title}</div>
                        <div class="artist">${tempMetadata[id].artist} - ${tempMetadata[id].album
        }</div>
                    </div>
                    <div class="duration">${formatTime(
          tempMetadata[id].time
        )}</div>
                `;
      div.onclick = () => playSong(id, div);
      resultsDiv.appendChild(div);
    });
    // 判断是否还有更多
    hasMore = data.PN * data.RN < data.TOTAL;
    currentPage = page;
  } catch (e) {
    if (!append)
      resultsDiv.innerHTML =
        '<div style="text-align:center;padding:24px;color:#f66;">搜索失败，请稍后重试</div>';
    hasMore = false;
  }
  loading = false;
}

function formatTime(sec) {
  if (!sec) return "";
  sec = parseInt(sec);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// 将KW_buildParams等函数改为纯前端实现
function buildKwParams(id, isLyricx = true) {
  const key = "yeelion";
  let params = `user=12345,web,web,web&requester=localhost&req=1&rid=MUSIC_${id}`;
  if (isLyricx) params += "&lrcx=1";
  return btoa(
    [...params]
      .map((c, i) =>
        String.fromCharCode(c.charCodeAt(0) ^ key.charCodeAt(i % key.length))
      )
      .join("")
  );
}

// 获取酷我歌词（支持解压和解码新版歌词）
async function fetchKwLyrics(musicId, isLyricx = true) {
  // 构建参数
  function buildParams(id, isLyricx) {
    const key = "yeelion";
    let params = `user=12345,web,web,web&requester=localhost&req=1&rid=MUSIC_${id}`;
    if (isLyricx) params += "&lrcx=1";
    const bufStr = new TextEncoder().encode(params);
    const bufKey = new TextEncoder().encode(key);
    const output = new Uint8Array(bufStr.length);
    for (let i = 0; i < bufStr.length; i++) {
      output[i] = bufStr[i] ^ bufKey[i % bufKey.length];
    }
    return btoa(String.fromCharCode(...output));
  }

  // 解码歌词内容
  async function decodeLyrics(buf, isLyricx) {
    const text = new TextDecoder("utf-8").decode(buf.slice(0, 20));
    if (!text.startsWith("tp=content")) return "";
    // 找到正文起始
    let offset = 0;
    for (let i = 0; i < buf.length - 3; i++) {
      if (
        buf[i] === 13 && // \r
        buf[i + 1] === 10 && // \n
        buf[i + 2] === 13 &&
        buf[i + 3] === 10
      ) {
        offset = i + 4;
        break;
      }
    }
    const lrcData = buf.slice(offset);
    // 解压
    let inflated;
    try {
      if ("decompress" in window && typeof window.decompress === "function") {
        // 如果页面有自定义解压函数
        inflated = await window.decompress(lrcData);
      } else if (window.pako) {
        inflated = window.pako.inflate(lrcData);
      } else if (typeof DecompressionStream !== "undefined") {
        // 浏览器原生解压
        const ds = new DecompressionStream("deflate");
        const stream = new Response(lrcData).body.pipeThrough(ds);
        inflated = new Uint8Array(await new Response(stream).arrayBuffer());
      } else {
        // 不支持解压
        return "";
      }
    } catch (e) {
      return "";
    }
    if (!isLyricx) {
      // 普通歌词直接解码
      return new TextDecoder("gb18030", { fatal: false }).decode(inflated);
    }
    // lrcx歌词需base64解码+异或
    let base64Str = "";
    try {
      base64Str = new TextDecoder("utf-8").decode(inflated);
    } catch {
      base64Str = String.fromCharCode(...inflated);
    }
    // base64转Uint8Array
    let lyricBuf;
    try {
      const bin = atob(base64Str);
      lyricBuf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) lyricBuf[i] = bin.charCodeAt(i);
    } catch {
      return "";
    }
    const key = new TextEncoder().encode("yeelion");
    const output = new Uint8Array(lyricBuf.length);
    for (let i = 0; i < lyricBuf.length; i++) {
      output[i] = lyricBuf[i] ^ key[i % key.length];
    }
    // gb18030解码
    try {
      // 尝试创建 gb18030 解码器
      if (window.TextDecoder) {
        try {
          return new TextDecoder("gb18030", { fatal: false }).decode(output);
        } catch (e) {
          // 不支持 gb18030
        }
      }
    } catch (e) { }
    // 兼容不支持gb18030的浏览器
    try {
      if (window.gb18030) {
        return window.gb18030.decode(output);
      }
    } catch (e) { }
    // 尝试utf-8
    return new TextDecoder("utf-8").decode(output);
  }

  const url = `http://newlyric.kuwo.cn/newlyric.lrc?${buildParams(
    musicId,
    isLyricx
  )}`;
  try {
    const res = await fetch(`proxy.php?url=${encodeURIComponent(url)}`);
    // const res = await fetch(url);
    const buf = new Uint8Array(await res.arrayBuffer());
    return await decodeLyrics(buf, isLyricx);
  } catch (e) {
    console.error("Get lyrics failed:", e);
    return "";
  }
}

// 修改播放歌曲函数,添加歌词获取
async function playSong(id, itemDiv) {
  if (currentPlayingId) {
    document
      .querySelectorAll(".result-item")
      .forEach((el) => el.classList.remove("playing"));
  }
  itemDiv.classList.add("playing");
  currentPlayingId = id;
  audioBar.style.display = "flex";
  // 更新底栏信息
  const meta = tempMetadata[id];
  navigator.mediaSession.metadata = new MediaMetadata({
    title: meta.title,
    artist: meta.artist,
    album: meta.album,
    artwork: [{ src: meta.cover }]
  });
  currentSongMeta = meta;
  audioCover.src = meta.cover || "";
  audioTitle.textContent = meta.title || "";
  audioArtist.textContent = meta.artist || "";
  audioTime.textContent = "0:00/" + formatTime(meta.time);
  // 更新弹窗信息
  playerModalCover.src = meta.cover || "";
  playerModalTitle.textContent = meta.title || "";
  playerModalArtist.textContent = meta.artist || "";
  // 获取播放地址
  try {
    const apiUrl = `https://api.limeasy.cn/kwmpro/v1/?id=${id}&quality=standard`;
    // const res = await fetch(`proxy.php?url=${encodeURIComponent(apiUrl)}`);
    const res = await fetch(apiUrl);
    const data = await res.json();
    if (data.code === 200 || data.code === 201) {
      // 处理 data.url: http->https, 第一个.替换为-
      let url = data.url.replace(/^http:/, "https:");
      url = url.replace(/\./, "-");
      audio.src = url;
      currentAudioUrl = url;
      audio.play();
      audioPlayBtn.innerHTML = '<i class="bi bi-pause-fill"></i>';
    } else {
      alert("获取播放地址失败");
    }
  } catch (e) {
    alert("播放失败");
  }
  // 获取歌词
  try {
    const lrcx = await fetchKwLyrics(id);
    if (lrcx && lrcx.includes("<")) {
      const yrc = parseKrcLyrics(lrcx);
      renderLyrics(yrc, audio);
    }
  } catch (e) {
    console.error("Load lyrics failed:", e);
  }
  // 更新背景
  if (meta.cover) {
    updateBackground(meta.cover);
  }
}

// 背景更新处理
function updateBackground(albumSrc) {
  let backgroundMode;
  if (window.innerWidth > 700) {
    backgroundMode = 0; // 流光
  } else {
    backgroundMode = 3; // 模糊
  }
  if (albumSrc) {
    if (backgroundMode == 3) {
      let blurEffect = config.getItem("playerSetting_blurEffect") ?? 70;
      let darknessEffect =
        config.getItem("playerSetting_darknessEffect") ?? 0.6;
      backgroundRule.textContent = `
                            #playerModalPanel::before {
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
      document.querySelector("#EX_background_fluentShine")?.remove();
    } else if (backgroundMode == 0 || backgroundMode == null) {
      if (document.querySelector("#EX_background_fluentShine")) {
        let blurEffect = config.getItem("playerSetting_blurEffect") ?? 70;
        let darknessEffect =
          config.getItem("playerSetting_darknessEffect") ?? 0.6;
        backgroundRule.textContent = `
            #EX_background_fluentShine {
              z-index: -1;
            }
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
        let fluentShineContainer = document.createElement("div");
        fluentShineContainer.id = "EX_background_fluentShine";
        fluentShineContainer.style.display = "block";
        fluentShineContainer.style.zIndex = -1;
        fluentShineContainer.style.flexWrap = "wrap";
        fluentShineContainer.style.background =
          "url(" + albumSrc + ") center/cover";

        for (let i = 1; i <= 4; i++) {
          let img = document.createElement("div");
          img.id = `EX_background_fluentShine${i}`;
          img.classList.add("fluentShine");
          img.style.position = "absolute";
          img.style.width = "50%";
          img.style.height = "50%";

          if (i === 1) {
            img.style.top = "0";
            img.style.left = "0";
          } else if (i === 2) {
            img.style.top = "0";
            img.style.right = "0";
          } else if (i === 3) {
            img.style.bottom = "0";
            img.style.left = "0";
          } else if (i === 4) {
            img.style.bottom = "0";
            img.style.right = "0";
          }

          let rotationDirection =
            i % 2 === 0 ? "clockwise" : "counterclockwise";
          let rotationSpeed = [15, 12, 18, 14][i - 1] || 14;
          img.style.animation = `rotate-${rotationDirection} ${rotationSpeed}s linear infinite`;

          fluentShineContainer.appendChild(img);
        }

        document
          .querySelector("#playerModalPanel")
          ?.appendChild(fluentShineContainer);

        let blurEffect = config.getItem("playerSetting_blurEffect") ?? 70;
        let darknessEffect =
          config.getItem("playerSetting_darknessEffect") ?? 0.6;
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

// 添加样式处理函数
function includeStyleElement(css, id) {
  const style = document.createElement("style");
  style.id = id;
  style.textContent = css;
  document.head.appendChild(style);
}

// 添加背景样式规则
let backgroundRule = document.createElement("style");
backgroundRule.id = "ExPlayerPageBg";
document.head.appendChild(backgroundRule);

// 观察器用于监听播放进度和歌词变化
let progressObserver = new MutationObserver(() => {
  const currentTime = document.querySelector("#progressCurrent")?.innerHTML;
  const totalTime = document.querySelector("#progressDuration")?.innerHTML;
  const timeElement = document.querySelector("#ExPlayerPlayTime");
  if (timeElement) {
    timeElement.innerHTML = `${currentTime} / ${totalTime}`;
  }
});

// 自动隐藏功能
let inactivityTimer;
const INACTIVITY_THRESHOLD = 3000;

function onInactivity() {
  if (!config.getItem("ext.playerPage.isEffect")) return;

  const bottom = document.querySelector(".bottom");
  if (!bottom) return;

  bottom.classList.add("hidden");
  bottom.style.backdropFilter = "blur(0px)";
}

function onActivity() {
  const bottom = document.querySelector(".bottom");
  if (!bottom) return;

  bottom.classList.remove("hidden");
  bottom.style.backdropFilter = "blur(70px)";
}

function resetInactivityTimer() {
  clearTimeout(inactivityTimer);
  if (config.getItem("ext.playerPage.autoHideBottom")) {
    inactivityTimer = setTimeout(onInactivity, INACTIVITY_THRESHOLD);
  }
}

// 监听用户活动
document.addEventListener("mousemove", onActivity);
document.addEventListener("mousedown", onActivity);
document.addEventListener("mouseup", onActivity);
document.addEventListener("wheel", onActivity);

// 解析酷我歌词
function parseKrcLyrics(krc) {
  const lines = krc.split("\n").filter((line) => line.trim());
  const yrc = [];
  let kuwoValue = 0;

  for (const line of lines) {
    const timeMatch = line.match(/^\[(\d+):(\d+)\.(\d+)\](.*)/);
    if (!timeMatch) {
      const kwMatch = line.match(/^\[kuwo:(\d+)\]/);
      if (kwMatch) kuwoValue = parseInt(kwMatch[1], 8);
      continue;
    }

    const [_, min, sec, ms, content] = timeMatch;
    const timestamp =
      (parseInt(min) * 60 + parseInt(sec)) * 1000 + parseInt(ms.padEnd(3, "0"));

    const words = [];
    const k1 = parseInt(kuwoValue / 10),
      k2 = kuwoValue % 10;
    let wordMatch;
    const wordRegex = /<(\d+),(-?\d+)>([^<]*)/g;

    while ((wordMatch = wordRegex.exec(content))) {
      const [_, v1, v2, text] = wordMatch;
      words.push({
        t: timestamp + (parseInt(v1) + parseInt(v2)) / (k1 * 2),
        d: (parseInt(v1) - parseInt(v2)) / (k2 * 2),
        tx: text,
      });
    }

    if (words.length) {
      const lastWord = words[words.length - 1];
      yrc.push({
        t: timestamp,
        d: lastWord.t + lastWord.d - timestamp,
        c: words,
      });
    }
  }

  return yrc;
}

// 渲染歌词
function renderLyrics(lyrics, audio) {
  const container = document.getElementById("lyrics");
  container.innerHTML = "";

  lyrics.forEach((line, i) => {
    // 判断是否为翻译行
    const isTranslationLine = line.c.length > 0 && Number(line.c[0].d) === 0;
    // 如果是翻译行且所有字母均为空格或空，则跳过该行
    if (
      isTranslationLine &&
      line.c.every((word) => !word.tx || word.tx.trim() === "")
    ) {
      return;
    }

    const div = document.createElement("div");
    div.className = "lyric-line";
    div.dataset.time = line.t;
    div.onclick = () => (audio.currentTime = line.t / 1000);

    if (isTranslationLine) {
      div.classList.add("translation-line");
    }

    line.c.forEach((word) => {
      const span = document.createElement("span");
      span.textContent = word.tx;
      span.dataset.time = word.t;
      span.dataset.duration = word.d;
      span.style.transition = `opacity ${word.d}ms ease-out`;
      div.appendChild(span);
    });

    container.appendChild(div);
  });

  let userScroll = 0;

  const lyricsContainer =
    document.getElementsByClassName("lyrics-container")[0];
  lyricsContainer.addEventListener("wheel", (e) => {
    userScroll = Date.now();
  });
  // 适配触摸滚动
  let touchStartY = 0;
  let touchMoved = false;
  lyricsContainer.addEventListener("touchstart", (e) => {
    if (e.touches.length === 1) {
      touchStartY = e.touches[0].clientY;
      touchMoved = false;
    }
  });
  lyricsContainer.addEventListener("touchmove", (e) => {
    if (e.touches.length === 1) {
      const deltaY = Math.abs(e.touches[0].clientY - touchStartY);
      if (deltaY > 5) {
        userScroll = Date.now();
        touchMoved = true;
      }
    }
  });

  // 逐字歌词高亮与滚动
  function updateActive() {
    const time = audio.currentTime * 1000;
    const lines = container.children;
    let activeLine = null;
    let nextLine = null;

    // 先找出当前激活行和下一行
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineTime = parseInt(line.dataset.time);
      const nextTime = lines[i + 1]
        ? parseInt(lines[i + 1].dataset.time)
        : Infinity;
      if (time >= lineTime && time < nextTime) {
        activeLine = line;
        nextLine = lines[i + 1] || null;
        break;
      }
    }

    // 合并循环，处理所有行
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isActive = line === activeLine;
      if (isActive) {
        line.classList.add("active");
        if (userScroll === 0 || Date.now() - userScroll > 2000) {
          line.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        // 处理翻译行高亮
        document.querySelectorAll(".translation-line").forEach((l) => {
          if (l.style.opacity !== "0.6") {
            l.style.opacity = "0.6";
          }
        });
        if (nextLine && nextLine.classList.contains("translation-line")) {
          nextLine.style.opacity = "1";
        }
      } else {
        line.classList.remove("active");
      }

      // 逐字高亮
      const spans = line.getElementsByTagName("span");
      let anyWordActive = false;
      for (const span of spans) {
        const t = parseInt(span.dataset.time);
        const d = parseInt(span.dataset.duration);
        if (isActive && time >= t && time < t + d) {
          span.classList.add("active");
          span.style.opacity = "1";
          span.style.textShadow =
            d >= 1000 ? "0 0 8px rgba(255,255,255,0.8)" : "none";
          anyWordActive = true;
        } else if (isActive && time >= t + d) {
          span.classList.remove("active");
          span.style.opacity = "1";
          span.style.textShadow = "none";
        } else {
          span.classList.remove("active");
          span.style.opacity = "0.6";
          span.style.textShadow = "none";
        }
      }
      // 如果没有单词处于激活状态，但整行歌词处于激活时间段
      // if (isActive && !anyWordActive && spans.length) {
      //   for (const span of spans) {
      //     span.style.opacity = "0.9";
      //     span.style.textShadow = "none";
      //   }
      // }
    }
  }

  audio.addEventListener("timeupdate", updateActive);
}

// 播放/暂停按钮
audioPlayBtn.onclick = function () {
  if (audio.paused) {
    audio.play();
  } else {
    audio.pause();
  }
};
audio.onplay = function () {
  audioPlayBtn.innerHTML = '<i class="bi bi-pause-fill"></i>';
};
audio.onpause = function () {
  audioPlayBtn.innerHTML = '<i class="bi bi-play-fill"></i>';
};
// 下载并复制文件名到剪贴板并弹窗提示
async function downloadAndCopyName(url, meta) {
  if (!url || !meta) return;
  const filename = `${meta.title || "歌曲"} - ${meta.artist || "未知"}.mp3`;
  // 下载
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.target = "_blank";
  a.click();
  // 复制到剪贴板
  try {
    await navigator.clipboard.writeText(filename);
  } catch (e) {
    alert(`已下载，文件名：${filename}\n（复制失败，请手动复制）`);
  }
}

// 控制栏下载按钮
audioDownloadBtn.onclick = function () {
  if (!currentAudioUrl || !currentSongMeta) return;
  downloadAndCopyName(currentAudioUrl, currentSongMeta);
};

// 下载按钮
audioDownloadBtn.onclick = function () {
  if (!currentAudioUrl) return;
  const a = document.createElement("a");
  a.href = currentAudioUrl;
  a.download = (currentSongMeta?.title || "music") + ".mp3";
  a.target = "_blank";
  a.click();
};
// 进度条
function updateProgressBar() {
  if (!audio.duration) return;
  const percent = (audio.currentTime / audio.duration) * 100;
  audioProgress.style.width = percent + "%";
  audioProgressDot.style.left = percent + "%";
  const current = isNaN(audio.currentTime) ? 0 : Math.floor(audio.currentTime);
  const duration = isNaN(audio.duration) ? 0 : Math.floor(audio.duration);
  audioTime.textContent = formatTime(current) + "/" + formatTime(duration);
}
audio.ontimeupdate = updateProgressBar;
audio.onloadedmetadata = updateProgressBar;
audio.onended = function () {
  audioPlayBtn.innerHTML = '<i class="bi bi-play-fill"></i>';
};
audioProgressBar.onclick = function (e) {
  if (!audio.duration) return;
  const rect = audioProgressBar.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const percent = Math.max(0, Math.min(1, x / rect.width));
  audio.currentTime = percent * audio.duration;
};

// 新增底栏收起按钮
if (!document.getElementById("audioHideBtn")) {
  const hideBtn = document.createElement("button");
  hideBtn.className = "audio-btn";
  hideBtn.id = "audioHideBtn";
  hideBtn.title = "收起播放页";
  hideBtn.innerHTML = '<i class="bi bi-chevron-down"></i>';
  hideBtn.style.display = "none";
  // hideBtn.style.display = 'flex';
  hideBtn.style.marginRight = "auto";
  hideBtn.onclick = function () {
    hidePlayerModal();
  };
  audioBar
    .querySelector(".audio-bar-inner")
    .insertBefore(hideBtn, audioBar.querySelector(".audio-cover"));
}
const audioHideBtn = document.getElementById("audioHideBtn");

// 点击封面弹出播放页面（全屏，无遮罩）
audioCover.onclick = function () {
  if (!currentSongMeta) return;
  playerModal.style.display = "block";
  playerModal.style.zIndex = 0;
  playerModal.style.position = "fixed";
  setTimeout(() => {
    playerModalPanel.classList.add("show");
  }, 10);
  audioBar.classList.add("show-hide-btn");
  audioHideBtn.style.display = "flex";
  audioBar.style.boxShadow = "none";
  audioBar.style.zIndex = 9;
  document.body.style.overflow = "hidden";
};
// 弹窗收起（底部弹出）
function hidePlayerModal() {
  playerModalPanel.classList.remove("show");
  setTimeout(() => {
    playerModal.style.display = "none";
    audioBar.classList.remove("show-hide-btn");
    audioHideBtn.style.display = "none";
    audioBar.style.boxShadow = "";
    audioBar.style.zIndex = 10;
  }, 350);
  document.body.style.overflow = "";
}

searchBtn.onclick = () => {
  const kw = searchInput.value.trim();
  if (kw) {
    currentKeyword = kw;
    searchSongs(kw, 0, false);
  }
};
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") searchBtn.onclick();
});

// 无限滚动加载下一页
resultsDiv.addEventListener("scroll", function () {
  if (!hasMore || loading) return;
  if (
    resultsDiv.scrollTop + resultsDiv.clientHeight >=
    resultsDiv.scrollHeight - 10
  ) {
    searchSon111gs(currentKeyword, currentPage + 1, true);
  }
});
// 兼容页面整体滚动（移动端）
window.addEventListener("scroll", function () {
  if (!hasMore || loading) return;
  const rect = resultsDiv.getBoundingClientRect();
  if (rect.bottom - window.innerHeight < 50) {
    searchSongs(currentKeyword, currentPage + 1, true);
  }
});

// 列表右键下载
resultsDiv.addEventListener("contextmenu", async function (e) {
  let target = e.target;
  // 向上查找 result-item
  while (target && !target.classList.contains("result-item")) {
    target = target.parentElement;
  }
  if (target && target.dataset.id) {
    e.preventDefault();
    const id = target.dataset.id;
    const meta = tempMetadata[id];
    if (!meta) return;
    // 获取播放地址
    try {
      const apiUrl = `https://api.limeasy.cn/kwmpro/v1/?id=${id}&quality=standard`;
      // const res = await fetch(`proxy.php?url=${encodeURIComponent(apiUrl)}`);
      const res = await fetch(apiUrl);
      const data = await res.json();
      if (data.code === 200 || data.code === 201) {
        downloadAndCopyName(data.url, meta);
      } else {
        alert("获取下载地址失败");
      }
    } catch (e) {
      alert("下载失败");
    }
  }
});

// 页面加载完成后添加 centered 类
document.addEventListener("DOMContentLoaded", () => {
  document.querySelector(".container").classList.add("centered");
});

// 初始化
config.listenChange("playerSetting_backgroundMode", () => {
  const cover = document.querySelector("#playerModalCover")?.src;
  if (cover) updateBackground(cover);
});
