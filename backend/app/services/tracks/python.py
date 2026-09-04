"""Python 赛道。"""

TRACK: dict = {
    "key": "python",
    "system_prompt_extra": """你是资深 Python 技术面试辅助 AI。用户正在进行 Python 技术面试，问题涉及
Python 语言特性（GIL/装饰器/生成器/元类/MRO/描述符）、Django/Flask/FastAPI Web 框架、
数据处理与分析（Pandas/NumPy/SciPy）、AI/机器学习（PyTorch/TensorFlow/scikit-learn/NLTK/spaCy）、
爬虫与自动化（Scrapy/Selenium/BeautifulSoup）、并发编程（asyncio/多线程/多进程）、
数据库（PostgreSQL/Redis/SQLAlchemy/psycopg2）、测试（pytest/unittest/coverage）、
代码质量（Mypy/Black/Pylint/Flake8）、可视化（Matplotlib/Plotly/Streamlit/Dash）、
包管理与部署（pip/poetry/Docker/Nginx）等 Python 技术栈。

回答应围绕 Python 生态，用 Python 开发者熟悉的术语和场景。""",

    "resume_intro_extra": """侧重 Python 技术栈经验：突出 Python 语言深度理解、
Web 框架（Django/Flask/FastAPI）项目经验、数据处理与 AI/ML 实践、
自动化与工具开发能力、并发与性能优化经验。""",

    "terms": {
        # ── Python 语言特性 ──
        "GIL": ["gil", "g i l", "全局解释器锁", "j i l", "记油"],
        "装饰器": ["装饰气", "装4器", "装时期", "decorator", "呆口瑞特"],
        "生成器": ["生成气", "generator", "金瑞特", "杰呢瑞特"],
        "协程": ["携程", "协程", "coroutine", "科入体"],
        "asyncio": ["a s y n c i o", "async io", "阿信柯", "a sync io"],
        "async/await": ["async await", "a sync a wait", "阿信柯额未特"],
        "列表推导式": ["列表推倒式", "列表推导", "list comprehension", "李斯特康普瑞汉神"],
        "字典推导式": ["字典推导", "dict comprehension"],
        "生成器表达式": ["生成器表达式", "generator expression"],
        "上下文管理器": ["上下文管理器", "context manager", "康泰克斯曼内哲"],
        "with语句": ["with语句", "with 语句", "位置语句"],
        "迭代器": ["迭代气", "iterator", "伊特瑞特"],
        "可迭代对象": ["可迭代对象", "iterable", "伊特惹波"],
        "类型注解": ["类型注解", "type hints", "type annotation", "太普安诺忒神"],
        "鸭子类型": ["鸭子类型", "duck typing", "达克太品"],
        "魔术方法": ["魔术方法", "magic method", "double under", "dunder"],
        "__init__": ["init", "因尼特", "double under init"],
        "__str__": ["str", "double under str"],
        "__repr__": ["repr", "double under repr"],
        "Garbage Collection": ["garbage collection", "垃圾回收", "gc", "g c"],
        "引用计数": ["引用记数", "reference counting", "瑞佛润斯康挺"],
        "循环引用": ["循环引用", "circular reference"],
        "深拷贝": ["深考贝", "deep copy", "迪普考皮"],
        "浅拷贝": ["前考贝", "shallow copy", "沙漏考皮"],
        "可变对象": ["可变对象", "mutable", "谬特波"],
        "不可变对象": ["不可变对象", "immutable", "因谬特波"],
        "元组": ["元组", "tuple", "太普欧", "tapple"],
        "命名元组": ["命名元组", "namedtuple", "内姆的太普欧"],
        "切片": ["切片", "slice", "斯莱斯"],
        "拆包": ["拆包", "unpacking", "安派克英"],
        "f-string": ["f string", "f string", "f死追应"],
        "Walrus Operator": ["walrus operator", "海象运算符", ":= 运算符"],
        "dataclass": ["data class", "数据类", "呆特克拉斯"],
        "enum": ["enum", "枚举", "一纳姆", "一能"],
        "lambda": ["lambda", "兰布达", "lam 达", "拉姆达"],

        # ── Web 框架 ──
        "Django": ["江狗", "django", "d j a n g o", "江哥", "捐狗", "酱狗"],
        "Flask": ["flask", "福莱斯克", "f l a s k", "弗拉斯克", "福拉斯克"],
        "FastAPI": ["fastapi", "fast api", "fast a p i", "发斯特api", "快api"],
        "DRF": ["drf", "d r f", "django rest framework", "django rest"],
        "Django ORM": ["django orm", "江狗orm", "django o r m"],
        "SQLAlchemy": ["sqlalchemy", "sql alchemy", "sql 奥切米", "s q l alchemy"],
        "Alembic": ["alembic", "阿冷比克", "a l e m b i c"],
        "Celery": ["celery", "赛乐瑞", "celery 任务队列", "赛乐瑞"],
        "Gunicorn": ["gunicorn", "古尼康", "guni corn", "独角兽"],
        "uWSGI": ["uwsgi", "u w s g i", "优wsgi"],
        "Nginx": ["nginx", "n吉克斯", "engine x"],
        "WSGI": ["wsgi", "w s g i", "威士忌"],
        "ASGI": ["asgi", "a s g i", "阿斯基"],
        "中间件": ["中间键", "中坚件", "middleware", "米斗威尔"],
        "路由": ["路由", "router", "饶特"],
        "视图": ["视图", "view", "viu"],
        "序列化器": ["序列化器", "serializer", "希尔莱泽"],
        "Jinja2": ["jinja", "金贾", "jinja2", "j i n j a"],
        "Django Admin": ["django admin", "江狗admin", "django管理后台"],

        # ── 数据处理 / AI / ML ──
        "NumPy": ["numpy", "n u m p y", "南派", "num pi", "楠普莱"],
        "Pandas": ["pandas", "p a n d a s", "潘达斯", "熊猫", "判达斯"],
        "DataFrame": ["dataframe", "data frame", "数据框", "戴特福瑞姆"],
        "Series": ["series", "希尔瑞斯", "s e r i e s"],
        "Matplotlib": ["matplotlib", "mat plot lib", "麦特普劳特利布", "马特普劳特里布"],
        "Seaborn": ["seaborn", "c博恩", "s e a b o r n"],
        "Scikit-learn": ["scikit learn", "sklearn", "s c i k i t learn", "赛课特learn"],
        "PyTorch": ["pytorch", "py torch", "派拓奇", "p y t o r c h"],
        "TensorFlow": ["tensorflow", "tensor flow", "坦瑟福漏", "t e n s o r f l o w"],
        "Keras": ["keras", "克拉斯", "k e r a s"],
        "Jupyter": ["jupyter", "朱皮特", "j u p y t e r", "就皮特"],
        "Notebook": ["notebook", "笔记本", "note book"],
        "NLP": ["nlp", "n l p", "自然语言处理"],
        "CNN": ["cnn", "c n n", "卷积神经网络"],
        "RNN": ["rnn", "r n n", "循环神经网络"],
        "Transformer": ["transformer", "transform", "川斯佛门"],
        "过拟合": ["过拟合", "overfitting", "欧文飞挺"],
        "欠拟合": ["欠拟合", "underfitting", "安德飞挺"],
        "梯度下降": ["梯度下降", "gradient descent", "格瑞迪恩特迪森特"],
        "反向传播": ["反向传播", "backpropagation", "拜克普若普给神"],
        "损失函数": ["损失函数", "loss function", "劳斯方格申"],
        "激活函数": ["激活函数", "activation function", "艾克提威神方格申"],
        "ReLU": ["relu", "r e l u", "瑞路"],
        "Softmax": ["softmax", "soft max", "骚福特麦克斯"],

        # ── 爬虫 / 自动化 ──
        "Scrapy": ["scrapy", "s c r a p y", "斯快皮", "斯奎皮"],
        "BeautifulSoup": ["beautifulsoup", "beautiful soup", "标特否苏普"],
        "Selenium": ["selenium", "赛琳尼姆", "s e l e n i u m"],
        "Requests": ["requests", "request", "瑞快斯"],
        "httpx": ["httpx", "h t t p x", "http x"],
        "aiohttp": ["aiohttp", "a i o http", "a i o http"],
        "XPath": ["xpath", "x path", "x怕死"],
        "正则表达式": ["正则表达式", "regex", "瑞杰克斯", "re jex"],
        "反爬": ["反爬", "anti crawl", "安提克肉"],

        # ── 测试 ──
        "pytest": ["pytest", "py test", "派test", "p y t e s t"],
        "unittest": ["unittest", "unit test", "优尼特test"],
        "mock": ["mock", "马可", "m o c k", "莫克"],
        "fixture": ["fixture", "菲克斯切", "f i x t u r e"],
        "coverage": ["coverage", "卡文瑞吉", "覆盖率"],
        "TDD": ["tdd", "t d d", "测试驱动开发"],

        # ── 包管理 / 环境 ──
        "pip": ["pip", "p i p", "皮普", "pip install"],
        "conda": ["conda", "康达", "c o n d a"],
        "virtualenv": ["virtualenv", "virtual env", "虚拟环境", "问道env"],
        "venv": ["venv", "v e n v", "威env"],
        "poetry": ["poetry", "波特瑞", "p o e t r y"],
        "PyPI": ["pypi", "py p i", "派p i", "p y p i"],
        "requirements.txt": ["requirements", "瑞快尔门茨", "依赖文件"],
        "setuptools": ["setuptools", "setup tools", "赛塔普兔斯"],
        "wheel": ["wheel", "威欧", "w h e e l"],

        # ── 并发 ──
        "多线程": ["多线程", "multithreading", "马欧体斯瑞丁"],
        "多进程": ["多进程", "multiprocessing", "马欧体普若赛斯"],
        "GIL": ["gil", "g i l", "全局锁", "全局解释器锁"],
        "线程池": ["线程池", "thread pool", "斯瑞的铺"],
        "进程池": ["进程池", "process pool", "普若赛斯铺"],
        "Queue": ["queue", "队列", "Q"],  # renamed to avoid conflict
        "Lock": ["lock", "锁", "唠嗑"],
        "Semaphore": ["semaphore", "赛马佛", "信号量"],
        "Event": ["event", "事件", "一问特"],
        "Condition": ["condition", "康迪神", "条件变量"],

        # ── 常用库 ──
        "os": ["os", "o s", "操作系统模块"],
        "sys": ["sys", "s y s", "系统模块"],
        "pathlib": ["pathlib", "path lib", "帕斯利布"],
        "argparse": ["argparse", "arg parse", "阿格帕斯"],
        "logging": ["logging", "劳ging", "日志模块"],
        "json": ["json", "j s o n", "杰森"],
        "pickle": ["pickle", "皮寇", "p i c k l e", "序列化"],
        "json模块": ["json模块", "json module"],
        "hashlib": ["hashlib", "hash lib", "哈西利布"],
        "itertools": ["itertools", "iterator tools", "伊特瑞兔斯"],
        "functools": ["functools", "func tools", "方格兔斯"],
        "collections": ["collections", "考莱克神", "集合模块"],
        "typing": ["typing", "太品", "类型模块"],

        # ── 数据库相关 ──
        "SQLite": ["sqlite", "sql lite", "s q l i t e", "sql赖特"],
        "PostgreSQL": ["postgresql", "postgres", "postgre sql", "p g sql", "破斯特格瑞sql"],
        "MySQL": ["mysql", "my sql", "my s q l", "买sql"],
        "MongoDB": ["mongodb", "mongo", "mongo db", "芒果db"],
        "ORM": ["orm", "o r m", "对象关系映射", "欧阿木"],
        "连接池": ["连接池", "connection pool", "康奈克神铺"],
        "迁移": ["迁移", "migration", "麦格瑞神"],
        "事务": ["事务", "transaction", "川赛克神"],
        "游标": ["游标", "cursor", "可色"],

        # ── Python 特有概念 ──
        "Pythonic": ["pythonic", "派桑尼克", "python风格"],
        "PEP 8": ["pep8", "pep 8", "p e p 8", "佩普8"],
        "Python 2": ["python2", "python二", "python 2"],
        "Python 3": ["python3", "python三", "python 3"],
        "CPython": ["cpython", "c python", "c派桑"],
        "PyPy": ["pypy", "py py", "派派"],
        "Cython": ["cython", "c ython", "赛桑"],
        "IPython": ["ipython", "i python", "爱派桑"],

        # ── 面向对象 / 高级特性 ──
        "元类": ["元类", "metaclass", "没他克拉斯", "元类编程"],
        "MRO": ["mro", "m r o", "方法解析顺序", "method resolution order"],
        "多继承": ["多继承", "multiple inheritance", "马欧体普因黑瑞疼斯"],
        "Mixin": ["mixin", "mix in", "米克森", "混入"],
        "猴子补丁": ["猴子补丁", "monkey patching", "芒可派青"],
        "描述符": ["描述符", "descriptor", "迪斯瑞普特"],
        "__slots__": ["slots", "斯劳茨", "double under slots"],
        "property": ["property", "普若普提", "@property", "at property"],
        "staticmethod": ["staticmethod", "static method", "斯达提克method", "@staticmethod"],
        "classmethod": ["classmethod", "class method", "克拉斯method", "@classmethod"],
        "抽象基类": ["抽象基类", "ABC", "a b c", "abstract base class", "阿布斯抓克特贝斯克拉斯"],
        "super": ["super", "苏泊", "super函数", "super方法"],
        "self": ["self", "赛欧夫", "self参数"],
        "星号参数": ["星号参数", "*args", "args", "阿格斯", "星号args"],
        "双星号参数": ["双星号参数", "**kwargs", "kwargs", "夸格斯", "k w args"],

        # ── 内置函数 / 常用模块 ──
        "enumerate": ["enumerate", "因牛莫瑞特", "一牛莫瑞特", "e n u m e r a t e"],
        "zip": ["zip", "z i p", "贼普", "压缩函数"],
        "map": ["map", "m a p", "迈普", "map函数"],
        "filter": ["filter", "f i l t e r", "飞奥特", "filter函数"],
        "reduce": ["reduce", "r e d u c e", "瑞丢斯", "reduce函数"],
        "defaultdict": ["defaultdict", "default dict", "迪佛特迪克特", "默认字典"],
        "OrderedDict": ["ordereddict", "ordered dict", "奥德迪克特", "有序字典"],
        "Counter": ["counter", "康特", "计数器", "c o u n t e r"],
        "ChainMap": ["chainmap", "chain map", "钱map", "链式映射"],
        "deque": ["deque", "d e q u e", "迪Q", "双端队列"],
        "heapq": ["heapq", "heap q", "hip q", "堆队列"],
        "bisect": ["bisect", "by sect", "拜赛克特", "二分模块"],
        "random": ["random", "软dom", "随机模块"],
        "datetime": ["datetime", "date time", "得特太姆", "日期时间模块"],
        "re模块": ["re模块", "re module", "正则模块", "r e模块"],
        "subprocess": ["subprocess", "sub process", "萨布普若赛斯", "子进程模块"],
        "tempfile": ["tempfile", "temp file", "泰普file", "临时文件"],
        "shutil": ["shutil", "s h u t i l", "舒提欧", "shell工具"],
        "glob": ["glob", "g l o b", "格劳布", "文件匹配"],

        # ── 代码质量 / 工程化 ──
        "Pylint": ["pylint", "py lint", "派lint", "p y l i n t"],
        "Flake8": ["flake8", "flake 8", "福雷克8", "f l a k e 8"],
        "Mypy": ["mypy", "my py", "买派", "m y p y", "类型检查"],
        "Black": ["black", "布莱克", "b l a c k", "代码格式化"],
        "isort": ["isort", "i sort", "爱sort", "import排序"],
        "pre-commit": ["precommit", "pre commit", "普瑞commit", "提交前检查"],
        "Tox": ["tox", "t o x", "套克斯", "tox测试"],
        "Nox": ["nox", "n o x", "诺克斯"],
        "Coverage": ["coverage", "卡文瑞吉", "覆盖率"],

        # ── Django 深度 ──
        "QuerySet": ["queryset", "query set", "快瑞赛特", "查询集"],
        "迁移文件": ["迁移文件", "migration file", "麦格瑞神file"],
        "makemigrations": ["makemigrations", "make migrations", "每课麦格瑞神"],
        "migrate": ["migrate", "麦格瑞特", "m i g r a t e"],
        "ModelAdmin": ["modeladmin", "model admin", "猫斗admin"],
        "FormView": ["formview", "form view", "佛姆viu"],
        "ListView": ["listview", "list view", "李斯特viu"],
        "DetailView": ["detailview", "detail view", "迪泰欧viu"],
        "Django REST": ["django rest", "江狗rest", "django rest framework"],

        # ── Flask/FastAPI 深度 ──
        "蓝图": ["蓝图", "blueprint", "布鲁普瑞特"],
        "请求钩子": ["请求钩子", "request hook", "瑞快斯特hook"],
        "依赖注入": ["依赖注入", "dependency injection", "迪盆登西因杰克神"],
        "Pydantic": ["pydantic", "py dantic", "派丹提克", "p y d a n t i c"],
        "中间件": ["中间键", "middleware", "米斗威尔"],

        # ── Python 新特性 ──
        "match case": ["match case", "麦吃case", "match语句", "模式匹配"],
        "类型守卫": ["类型守卫", "type guard", "type narrowing", "类型窄化"],
        "Union": ["union", "union type", "尤尼恩", "联合类型"],
        "Optional": ["optional", "option al", "奥普申诺", "可选类型"],
        "Protocol": ["protocol", "pro to col", "普若托口", "协议类型"],
        "TypedDict": ["typeddict", "typed dict", "太普特迪克特"],
        "Literal": ["literal", "利特肉", "字面量类型"],

        # ── 并发 / 异步 ──
        "concurrent.futures": ["concurrent futures", "concurrent点futures", "康卡瑞特 futures"],
        "ThreadPoolExecutor": ["threadpoolexecutor", "thread pool executor", "斯瑞的铺executor", "线程池执行器"],
        "ProcessPoolExecutor": ["processpoolexecutor", "process pool executor", "普若赛斯铺executor"],
        "Future": ["future", "f u t u r e", "飞优切"],
        "async generator": ["async generator", "异步生成器", "async 生成器"],
        "asyncio.gather": ["asyncio gather", "async io gather", "阿信柯盖泽"],
        "asyncio.create_task": ["asyncio create task", "create task", "克瑞艾特task"],
        "asyncio.run": ["asyncio run", "async io run", "阿信柯软"],

        # ── 网络编程 ──
        "socket": ["socket", "s o c k e t", "骚克特", "套接字"],
        "urllib": ["urllib", "u r l lib", "url lib", "优阿lib"],
        "HTTPX": ["httpx", "h t t p x", "h t t p x", "http x"],
        "websockets": ["websockets", "web sockets", "web socket", "微博sockets"],

        # ── Django 扩展 ──
        "Signals": ["signals", "sig nals", "西格诺斯", "信号"],
        "Middleware": ["middleware", "middle ware", "米斗威尔", "中间件"],
        "Serializer": ["serializer", "希尔莱泽", "s e r i a l i z e r", "序列化器"],
        "ViewSet": ["viewset", "view set", "viu赛特"],
        "Router": ["router", "饶特", "路由"],
        "ModelSerializer": ["modelserializer", "model serializer", "猫斗希尔莱泽"],
        "GenericAPIView": ["genericapiview", "generic api view", "基奈瑞克api view"],

        # ── 数据库驱动 ──
        "psycopg2": ["psycopg2", "psyco pg2", "赛口pg2", "p s y c o p g"],
        "sqlite3": ["sqlite3", "sqlite三", "sql赖特3", "s q l i t e 3"],
        "Redis": ["redis", "瑞迪斯", "red is", "r e d i s"],
        "aiosqlite": ["aiosqlite", "a i o sqlite", "阿一欧sqlite"],
        "asyncpg": ["asyncpg", "async pg", "阿信柯pg", "a s y n c p g"],

        # ── 科学计算 ──
        "SciPy": ["scipy", "sci py", "赛派", "s c i p y", "赛皮"],
        "OpenCV": ["opencv", "open cv", "欧本cv", "open c v"],
        "Pillow": ["pillow", "皮楼", "p i l l o w", "派楼"],
        "NLTK": ["nltk", "n l t k", "自然语言工具包"],
        "spaCy": ["spacy", "spa cy", "斯贝西", "s p a c y"],
        "Transformers": ["transformers", "trans formers", "川斯佛门斯", "huggingface"],

        # ── 可视化 / 仪表板 ──
        "Plotly": ["plotly", "plot ly", "普劳特利", "p l o t l y"],
        "Dash": ["dash", "d a s h", "戴西", "plotly dash"],
        "Streamlit": ["streamlit", "stream lit", "斯追姆利特", "stream light"],
        "Bokeh": ["bokeh", "bo keh", "波凯", "b o k e h"],

        # ── 杂项常用 ──
        "YAML": ["yaml", "y a m l", "雅某", "yam 文件"],
        "TOML": ["toml", "t o m l", "汤姆l", "tom 文件"],
        "dotenv": ["dotenv", "dot env", "道特env", "点env"],
        "Click": ["click", "click库", "c l i c k", "克立克"],
        "Rich": ["rich", "r i c h", "瑞驰", "rich库"],
        "TQDM": ["tqdm", "t q d m", "提Qdm", "进度条"],
    },
}
