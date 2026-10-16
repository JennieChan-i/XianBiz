#define MyAppVersion "1.0.0"
[Setup]
AppId={{81E40BCF-D5F5-4138-8A98-02BA5E862193}
AppName=XianBiz 纤商
AppVersion={#MyAppVersion}
AppPublisher=XianBiz
DefaultDirName={autopf}\XianBiz
DefaultGroupName=XianBiz 纤商
OutputDir=..\artifacts
OutputBaseFilename=XianBiz-Setup-1.0.0
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes
RestartApplications=no
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=commandline
UninstallDisplayIcon={app}\XianBiz.exe
[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
[Files]
Source: "..\dist\XianBiz\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{group}\纤商"; Filename: "{app}\XianBiz.exe"
Name: "{autodesktop}\纤商"; Filename: "{app}\XianBiz.exe"; Tasks: desktopicon
[Tasks]
Name: "desktopicon"; Description: "创建桌面启动图标"; Flags: checkedonce
[Run]
Filename: "{app}\XianBiz.exe"; Description: "启动纤商"; Flags: nowait postinstall skipifsilent
; User data under LOCALAPPDATA/XianBiz is intentionally never an uninstall target.
