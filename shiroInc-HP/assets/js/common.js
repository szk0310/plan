$(function () {

  /*--------------------------------
    smoothscroll
 ---------------------------------*/
  var headerHeight = $('header').innerHeight() - 1;
  $('a[href^="#"]:not(.js-modal-open,.modal-close)').click(function () {
    var speed = 700;
    var href = $(this).attr("href");
    var target = $(href === "#" || href === "" ? 'html' : href);
    var position = target.offset().top - headerHeight;
    $("html, body").animate({
      scrollTop: position
    }, speed, "swing");
    return false;
  });

});

/*--------------------------------
      ハンバーガーmenu
   ---------------------------------*/

$('#sp-menu-trigger').click(function () {
  $("header").toggleClass('open');
  $("header nav").slideToggle();
});


$('header nav li a ').click(function () {
  if ($(window).innerWidth() <= 900) {
    $('#sp-menu-trigger').trigger('click');
    $("header").removeClass('open');
  } else {
    ;
  }
});


$(window).on('load resize', function () {

  $("header").removeClass('open');

  if ($(window).innerWidth() <= 900) {
    //スマホの時の状態
    $('#sp-menu-trigger').show();
    $("header nav").hide();
  } else {
    //タブレット・PCの時の状態
    $('#sp-menu-trigger').hide();
    $("header nav").show();
  }
});


/*--------------------------------
       textアニメーション
   ---------------------------------*/
setTimeout(() => {
  $(".mv-copy.text-span").addClass('show');
}, 0);

setTimeout(() => {
  $(".mv-copy2.text-span.pc").addClass('show');
}, 300);

setTimeout(() => {
  $(".mv-copy2.text-span.sp").addClass('show');
}, 200);
setTimeout(() => {
  $(".mv-copy3.text-span.sp").addClass('show');
}, 400);
setTimeout(() => {
  $(".mv-copy4.text-span.sp").addClass('show');
}, 600);
setTimeout(() => {
  $(".mv-copy5.text-span.sp").addClass('show');
}, 800);


/*--------------------------------
       スクロールclass付与
   ---------------------------------*/
const myFunc = function () {
  //Classを追加する要素を取得
  const target = document.getElementsByClassName('text-span');
  const target1 = document.getElementsByClassName('border');
  const target2 = document.getElementsByClassName('border2');
  //Classを追加する位置を指定（ビューポート内）

  const position = Math.floor(window.innerHeight * .75); //左記はビューポート内の上から75%の位置を指定

  for (let i = 0; i < target.length; i++) {
    //要素の上部座標を取得する（小数点切り捨て）
    let offsetTop = Math.floor(target[i].getBoundingClientRect().top);
    //要素の上部座標がpositionの位置を通過したら
    if (offsetTop < position) {
      //要素にClassを追加する
      target[i].classList.add('show');
    }
  }

  for (let i = 0; i < target1.length; i++) {
    //要素の上部座標を取得する（小数点切り捨て）
    let offsetTop = Math.floor(target1[i].getBoundingClientRect().top);
    //要素の上部座標がpositionの位置を通過したら
    if (offsetTop < position) {
      //要素にClassを追加する
      target1[i].classList.add('active');
    }
  }
  for (let i = 0; i < target2.length; i++) {
    //要素の上部座標を取得する（小数点切り捨て）
    let offsetTop = Math.floor(target2[i].getBoundingClientRect().top);
    //要素の上部座標がpositionの位置を通過したら
    if (offsetTop < position) {
      //要素にClassを追加する
      target2[i].classList.add('active');
    }
  }
}
//スクロールイベントリスナーに登録
window.addEventListener('scroll', myFunc, false);



