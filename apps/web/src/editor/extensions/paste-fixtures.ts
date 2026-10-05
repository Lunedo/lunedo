export const pasteFixtures = {
  word: `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta name=Generator content="Microsoft Word 15"><style><!-- p.MsoNormal {margin:0cm; font-family:"Calibri",sans-serif;} --></style><!--[if gte mso 9]><xml><w:WordDocument><w:View>Normal</w:View></w:WordDocument></xml><![endif]--></head>
<body lang=DE style='tab-interval:35.4pt'><!--StartFragment-->
<h1 style='mso-style-link:"Überschrift 1 Zchn"'><span style='mso-fareast-font-family:"Times New Roman"'>Quarterly review<o:p></o:p></span></h1>
<p class=MsoNormal>The <b><span style='color:#C00000'>numbers</span></b> look <i>good</i> this <u>quarter</u>.<o:p></o:p></p>
<p class=MsoListParagraphCxSpFirst style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol;mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp; </span></span><![endif]>First point<o:p></o:p></p>
<p class=MsoListParagraphCxSpLast style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol;mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp; </span></span><![endif]>Second point<o:p></o:p></p>
<table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0 style='border-collapse:collapse;mso-yfti-tbllook:1184'><tr><td width=302 valign=top style='width:226.5pt;background:#FFFF00'><p class=MsoNormal>Cell A<o:p></o:p></p></td><td width=302 valign=top><p class=MsoNormal>Cell B<o:p></o:p></p></td></tr></table>
<p class=MsoNormal><a href="https://example.org/report">Full report</a> and <a href="file:///C:/secret.docx">a local file</a><o:p></o:p></p>
<!--EndFragment--></body></html>
`,
  googleDocs: `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1a2b3c4d-7fff-1234-abcd-0123456789ab"><h2 dir="ltr" style="line-height:1.38;margin-top:18pt;margin-bottom:6pt;"><span style="font-size:16pt;font-family:Arial,sans-serif;color:#000000;font-weight:400;">Launch plan</span></h2><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;font-weight:700;">Bold words</span><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;font-weight:400;"> and </span><span style="font-size:11pt;font-family:Arial,sans-serif;color:#ff0000;font-style:italic;font-weight:400;">italic red</span><span style="font-size:11pt;font-family:Arial,sans-serif;text-decoration:line-through;"> struck</span></p><ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:disc;font-size:11pt;" aria-level="1"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;">Item one</span></p></li><li dir="ltr" style="list-style-type:disc;font-size:11pt;" aria-level="1"><p dir="ltr" role="presentation"><span style="font-size:11pt;">Item two</span></p></li></ul><p dir="ltr"><img src="https://lh3.googleusercontent.com/abc" width="200" height="100"><span>After the image</span></p></b><br class="Apple-interchange-newline">
`,
  webPage: `<div class="article" onclick="steal()"><style>body { display: none }</style><script>alert("x")</script>
<h3 id="intro" onmouseover="steal()">Install the client</h3>
<p style="font-family: Comic Sans">Download it from <a href="javascript:alert(1)">this link</a> or <a href="https://vendor.example/download" target="_blank" onclick="track()">the vendor</a>.</p>
<custom-widget data-x="1"><span>Unknown element text</span></custom-widget>
<iframe src="https://evil.example/frame"></iframe>
<pre><code class="language-bash">sudo apt install wireguard</code></pre>
<pre><code class="language-notalanguage">echo hi</code></pre>
<img src="x" onerror="alert(1)">
<span data-type="mention" data-id="not-a-uuid">@Someone</span>
<span data-type="status" data-text="" data-color="neon">bad status</span>
<blockquote><p>Quoted <mark style="background: lime">text</mark></p></blockquote>
<ol start="0"><li>Zero start</li></ol>
<table><tr><th colspan="0">Head</th></tr><tr><td data-colwidth="abc">Body</td></tr></table>
<form><input type="text" value="secret"><button>Send</button></form>
</div>
`,
};
