import IconFont from '@/components/iconfont';
import useFilterTreeData from '@/hooks/useFilterTreeData';
import { SharedContext } from '@/layouts';
import { depthFirstSearch, findNode, getEditorMode } from '@/utils';
import config from '@/utils/config';
import { request } from '@/utils/http';
import { canPreviewInMonaco } from '@/utils/monaco';
import {
  CloudDownloadOutlined,
  DeleteOutlined,
  EditOutlined,
  EllipsisOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-layout';
import Editor from '@monaco-editor/react';
import { langs } from '@uiw/codemirror-extensions-langs';
import CodeMirror from '@uiw/react-codemirror';
import { history, useOutletContext } from '@umijs/max';
import {
  Button,
  Dropdown,
  Empty,
  Input,
  MenuProps,
  message,
  Modal,
  Tooltip,
  Tree,
  TreeSelect,
  Typography,
} from 'antd';
import { saveAs } from 'file-saver';
import debounce from 'lodash/debounce';
import uniq from 'lodash/uniq';
import prettyBytes from 'pretty-bytes';
import { parse } from 'query-string';
import { Key, useCallback, useEffect, useRef, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import intl from 'react-intl-universal';
import SplitPane from 'react-split-pane';
import EditModal from './editModal';
import EditScriptNameModal from './editNameModal';
import styles from './index.module.less';
import RenameModal from './renameModal';
import UnsupportedFilePreview from './components/UnsupportedFilePreview';
const { Text } = Typography;

const Script = () => {
  const { headerStyle, isPhone, theme } = useOutletContext<SharedContext>();
  const [value, setValue] = useState(intl.get('请选择脚本文件'));
  const [select, setSelect] = useState<string>(intl.get('请选择脚本文件'));
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState('');
  const [height, setHeight] = useState<number>();
  const treeDom = useRef<any>();
  const [isLogModalVisible, setIsLogModalVisible] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const editorRef = useRef<any>(null);
  const [isAddFileModalVisible, setIsAddFileModalVisible] = useState(false);
  const [isRenameFileModalVisible, setIsRenameFileModalVisible] =
    useState(false);
  const [currentNode, setCurrentNode] = useState<any>();
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [showMonaco, setShowMonaco] = useState(true);

  const handleIsEditing = (filename: string, value: boolean) => {
    setIsEditing(value && canPreviewInMonaco(filename));
  };

  const getScripts = (needLoading: boolean = true) => {
    needLoading && setLoading(true);
    request
      .get(`${config.apiPrefix}scripts`)
      .then(({ code, data }) => {
        if (code === 200) {
          setData(data);
          initState();
          initGetScript(data);
        }
      })
      .finally(() => needLoading && setLoading(false));
  };

  const getDetail = (node: any, options: any = {}) => {
    request
      .get(
        `${config.apiPrefix}scripts/detail?file=${encodeURIComponent(
          node.title,
        )}&path=${node.parent || ''}`,
      )
      .then(({ code, data }) => {
        if (code === 200) {
          setValue(data);
          if (options.callback) {
            options.callback();
          }
        }
      });
  };

  const downloadScript = () => {
    request
      .post<Blob>(
        `${config.apiPrefix}scripts/download`,
        {
          filename: currentNode.title,
          path: currentNode.parent || '',
        },
        { responseType: 'blob' },
      )
      .then((res) => {
        saveAs(res, currentNode.title);
      });
  };

  const initGetScript = (_data: any) => {
    const { p, s } = parse(history.location.search);
    if (s) {
      const vkey = `${p}/${s}`;
      const obj = {
        node: {
          title: s,
          key: p ? vkey : s,
          parent: p,
        },
      };
      const item = findNode(_data, (c) => c.key === obj.node.key);
      if (item) {
        obj.node = item;
        setExpandedKeys([p as string]);
        onTreeSelect([vkey], obj);
      }
    }
  };

  const onSelect = (value: any, node: any) => {
    if (node.key === select || !value) {
      return;
    }

    setSelect(node.key);
    setCurrentNode(node);

    if (node.type === 'directory') {
      setValue(intl.get('请选择脚本文件'));
      setShowMonaco(true);
      return;
    }

    if (!canPreviewInMonaco(node.title)) {
      setShowMonaco(false);
      return;
    }

    setShowMonaco(true);
    const newMode = getEditorMode(value);
    setMode(isPhone && newMode === 'typescript' ? 'javascript' : newMode);
    setValue(intl.get('加载中...'));

    getDetail(node, {
      callback: () => {
        if (isEditing) {
          setIsEditing(true);
        }
      },
    });
  };

  const onTreeSelect = useCallback(
    (keys: Key[], e: any) => {
      const node = e.node;
      if (node.key === select && isEditing) {
        return;
      }

      const currentContent = editorRef.current
        ? editorRef.current.getValue().replace(/\r\n/g, '\n')
        : value;
      const originalContent = value.replace(/\r\n/g, '\n');

      if (currentContent !== originalContent && isEditing) {
        Modal.confirm({
          title: intl.get('确认离开'),
          content: <>{intl.get('当前文件未保存，确认离开吗')}</>,
          onOk() {
            onSelect(keys[0], e.node);
            handleIsEditing(e.node.title, false);
          },
        });
      } else {
        handleIsEditing(e.node.title, false);
        onSelect(keys[0], e.node);
      }
    },
    [value, select, isEditing],
  );

  const onSearch = useCallback(
    (e) => {
      const keyword = e.target.value;
      debounceSearch(keyword);
    },
    [data],
  );

  const debounceSearch = useCallback(
    debounce((keyword) => {
      setSearchValue(keyword);
    }, 300),
    [data],
  );

  const { treeData: filterData, keys: searchExpandedKeys } = useFilterTreeData(
    data,
    searchValue,
    { treeNodeFilterProp: 'title' },
  );

  useEffect(() => {
    setExpandedKeys(uniq([...expandedKeys, ...searchExpandedKeys]));
  }, [searchExpandedKeys]);

  const onExpand = (expKeys: any) => {
    setExpandedKeys(expKeys);
  };

  const onDoubleClick = (e: any, node: any) => {
    if (node.type === 'file') {
      setSelect(node.key);
      setCurrentNode(node);
      handleIsEditing(node.title, true);
    }
  };

  const editFile = () => {
    setTimeout(() => {
      handleIsEditing(currentNode.title, true);
    }, 300);
  };

  const cancelEdit = () => {
    handleIsEditing(currentNode.title, false);
    setValue(intl.get('加载中...'));
    getDetail(currentNode);
  };

  const saveFile = () => {
    Modal.confirm({
      title: `确认保存`,
      content: (
        <>
          {intl.get('确认保存文件')}
          <Text style={{ wordBreak: 'break-all' }} type="warning">
            {' '}
            {currentNode.title}
          </Text>
          {intl.get('，保存后不可恢复')}
        </>
      ),
      onOk() {
        const content = editorRef.current
          ? editorRef.current.getValue().replace(/\r\n/g, '\n')
          : value;
        return new Promise((resolve, reject) => {
          request
            .put(`${config.apiPrefix}scripts`, {
              filename: currentNode.title,
              path: currentNode.parent || '',
              content,
            })
            .then(({ code, data }) => {
              if (code === 200) {
                message.success(`保存成功`);
                setValue(content);
                handleIsEditing(currentNode.title, false);
              }
              resolve(null);
            })
            .catch((e) => reject(e));
        });
      },
    });
  };

  const deleteFile = () => {
    Modal.confirm({
      title: `确认删除`,
      content: (
        <>
          {intl.get('确认删除')}
          <Text style={{ wordBreak: 'break-all' }} type="warning">
            {' '}
            {select}{' '}
          </Text>
          {intl.get('文件')}
          {currentNode.type === 'directory' ? intl.get('夹及其子文件') : ''}
          {intl.get('，删除后不可恢复')}
        </>
      ),
      onOk() {
        request
          .delete(`${config.apiPrefix}scripts`, {
            data: {
              filename: currentNode.title,
              path: currentNode.parent || '',
              type: currentNode.type,
            },
          })
          .then(({ code }) => {
            if (code === 200) {
              message.success(`删除成功`);
              let newData = [...data];
              if (currentNode.parent) {
                newData = depthFirstSearch(
                  newData,
                  (c) => c.key === currentNode.key,
                );
              } else {
                const index = newData.findIndex(
                  (x) => x.key === currentNode.key,
                );
                if (index !== -1) {
                  newData.splice(index, 1);
                }
              }
              setData(newData);
              initState();
            }
          });
      },
    });
  };

  const renameFile = () => {
    setIsRenameFileModalVisible(true);
  };

  const handleRenameFileCancel = () => {
    setIsRenameFileModalVisible(false);
    getScripts(false);
  };

  const addFile = () => {
    setIsAddFileModalVisible(true);
  };

  const addFileModalClose = async (
    {
      filename,
      path,
      key,
      type,
    }: { filename: string; path: string; key: string; type?: string } = {
      filename: '',
      path: '',
      key: '',
    },
  ) => {
    if (filename) {
      const res = await request.get(`${config.apiPrefix}scripts`);
      let newData = res.data;
      if (type === 'directory' && filename.includes('/')) {
        const parts = filename.split('/');
        parts.pop();
        const parentPath = parts.join('/');
        path = path ? `${path}/${parentPath}` : parentPath;
      }
      const item = findNode(newData, (c) => c.key === key);
      if (path) {
        const keys = path.split('/');
        const sKeys: string[] = [];
        keys.reduce((p, c) => {
          sKeys.push(p);
          return `${p}/${c}`;
        });
        setExpandedKeys([...expandedKeys, ...sKeys, path]);
      }
      setData(newData);
      onSelect(item.title, item);
      handleIsEditing(item.title, true);
    }
    setIsAddFileModalVisible(false);
  };

  const initState = () => {
    setSelect(intl.get('请选择脚本文件'));
    setCurrentNode(null);
    setValue(intl.get('请选择脚本文件'));
  };

  useEffect(() => {
    getScripts();
  }, []);

  useEffect(() => {
    if (treeDom.current) {
      setHeight(treeDom.current.clientHeight - 6);
    }
  }, [treeDom.current, data]);

  useHotkeys(
    'mod+s',
    (e) => {
      if (isEditing) {
        saveFile();
      }
    },
    { enableOnFormTags: ['textarea'], preventDefault: true },
  );

  useHotkeys(
    'mod+d',
    (e) => {
      if (currentNode.title) {
        deleteFile();
      }
    },
    { preventDefault: true },
  );

  useHotkeys(
    'mod+o',
    (e) => {
      if (!isEditing) {
        addFile();
      }
    },
    { preventDefault: true },
  );

  useHotkeys(
    'mod+e',
    (e) => {
      if (currentNode.title) {
        cancelEdit();
      }
    },
    { preventDefault: true },
  );

  const action = (key: string | number) => {
    switch (key) {
      case 'save':
        saveFile();
        break;
      case 'exit':
        cancelEdit();
        break;
      default:
        break;
    }
  };

  const menuAction = (key: string | number) => {
    switch (key) {
      case 'add':
        addFile();
        break;
      case 'edit':
        editFile();
        break;
      case 'delete':
        deleteFile();
        break;
      case 'rename':
        renameFile();
        break;
      default:
        break;
    }
  };

  const menu: MenuProps = isEditing
    ? {
        items: [
          { label: intl.get('保存'), key: 'save', icon: <PlusOutlined /> },
          { label: intl.get('退出编辑'), key: 'exit', icon: <EditOutlined /> },
        ],
        onClick: ({ key, domEvent }) => {
          domEvent.stopPropagation();
          action(key);
        },
      }
    : {
        items: [
          { label: intl.get('创建'), key: 'add', icon: <PlusOutlined /> },
          {
            label: intl.get('编辑'),
            key: 'edit',
            icon: <EditOutlined />,
            disabled: !currentNode,
          },
          {
            label: intl.get('重命名'),
            key: 'rename',
            icon: <IconFont type="ql-icon-rename" />,
            disabled: !currentNode,
          },
          {
            label: intl.get('删除'),
            key: 'delete',
            icon: <DeleteOutlined />,
            disabled: !currentNode,
          },
        ],
        onClick: ({ key, domEvent }) => {
          domEvent.stopPropagation();
          menuAction(key);
        },
      };

  const handleForceOpen = () => {
    if (!currentNode) return;

    setMode('plaintext');
    setValue(intl.get('加载中...'));
    setShowMonaco(true);

    getDetail(currentNode, {
      callback: () => {
        setIsEditing(true);
      },
    });
  };

  return (
    <PageContainer
      className="ql-container-wrapper log-wrapper"
      title={
        <>
          {select}
          {currentNode?.type === 'file' && (
            <span
              style={{
                marginLeft: 6,
                fontSize: 12,
                color: '#999',
                display: 'inline-block',
                height: 14,
              }}
            >
              {prettyBytes(currentNode.size)}
            </span>
          )}
        </>
      }
      loading={loading}
      extra={
        isPhone
          ? [
              <TreeSelect
                treeExpandAction="click"
                className="log-select"
                value={select}
                dropdownStyle={{ maxHeight: 400, overflow: 'auto' }}
                treeData={data}
                placeholder={intl.get('请选择脚本')}
                fieldNames={{ value: 'key' }}
                treeNodeFilterProp="title"
                showSearch
                allowClear
                onSelect={onSelect}
              />,
              <Dropdown menu={menu} trigger={['click']}>
                <Button type="primary" icon={<EllipsisOutlined />} />
              </Dropdown>,
            ]
          : isEditing
          ? [
              <Button type="primary" onClick={saveFile}>
                {intl.get('保存')}
              </Button>,
              <Button type="primary" onClick={cancelEdit}>
                {intl.get('退出编辑')}
              </Button>,
            ]
          : [
              <Tooltip title={intl.get('创建')}>
                <Button
                  type="primary"
                  onClick={addFile}
                  icon={<PlusOutlined />}
                />
              </Tooltip>,
              <Tooltip title={intl.get('编辑')}>
                <Button
                  disabled={!currentNode}
                  type="primary"
                  onClick={editFile}
                  icon={<EditOutlined />}
                />
              </Tooltip>,
              <Tooltip title={intl.get('重命名')}>
                <Button
                  disabled={!currentNode}
                  type="primary"
                  onClick={renameFile}
                  icon={<IconFont type="ql-icon-rename" />}
                />
              </Tooltip>,
              <Tooltip title={intl.get('下载')}>
                <Button
                  disabled={!currentNode || currentNode.type === 'directory'}
                  type="primary"
                  onClick={downloadScript}
                  icon={<CloudDownloadOutlined />}
                />
              </Tooltip>,
              <Tooltip title={intl.get('删除')}>
                <Button
                  type="primary"
                  disabled={!currentNode}
                  onClick={deleteFile}
                  icon={<DeleteOutlined />}
                />
              </Tooltip>,
              <Button
                type="primary"
                onClick={() => {
                  setIsLogModalVisible(true);
                }}
              >
                {intl.get('调试')}
              </Button>,
            ]
      }
      header={{
        style: headerStyle,
      }}
    >
      <div className={`${styles['log-container']} log-container`}>
        {!isPhone && (
          /*// @ts-ignore*/
          <SplitPane split="vertical" size={200} maxSize={-100}>
            <div className={styles['left-tree-container']}>
              {data.length > 0 ? (
                <>
                  <Input.Search
                    className={styles['left-tree-search']}
                    onChange={onSearch}
                    placeholder={intl.get('请输入脚本名')}
                    allowClear
                  ></Input.Search>
                  <div className={styles['left-tree-scroller']} ref={treeDom}>
                    <Tree
                      expandAction="click"
                      className={styles['left-tree']}
                      treeData={filterData}
                      showIcon={true}
                      height={height}
                      selectedKeys={[select]}
                      expandedKeys={expandedKeys}
                      onExpand={onExpand}
                      showLine={{ showLeafIcon: true }}
                      onSelect={onTreeSelect}
                      onDoubleClick={onDoubleClick}
                    ></Tree>
                  </div>
                </>
              ) : (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    height: '100%',
                  }}
                >
                  <Empty
                    description={intl.get('暂无脚本')}
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                  />
                </div>
              )}
            </div>
            {showMonaco ? (
              <Editor
                language={mode}
                value={value}
                theme={theme}
                options={{
                  readOnly: !isEditing,
                  fontSize: 12,
                  lineNumbersMinChars: 3,
                  glyphMargin: false,
                  accessibilitySupport: 'off',
                }}
                onMount={(editor) => {
                  editorRef.current = editor;
                }}
              />
            ) : (
              <UnsupportedFilePreview onForceOpen={handleForceOpen} />
            )}
          </SplitPane>
        )}
        {isPhone && (
          <CodeMirror
            value={value}
            extensions={
              mode ? [langs[mode as keyof typeof langs]()] : undefined
            }
            theme={theme.includes('dark') ? 'dark' : 'light'}
            readOnly={!isEditing}
            onChange={(value) => {
              setValue(value);
            }}
          />
        )}
        {isLogModalVisible && isLogModalVisible && (
          <EditModal
            treeData={data}
            currentNode={currentNode}
            content={value}
            handleCancel={() => {
              setIsLogModalVisible(false);
            }}
          />
        )}
        {isAddFileModalVisible && (
          <EditScriptNameModal
            treeData={data}
            handleCancel={addFileModalClose}
          />
        )}
        {isRenameFileModalVisible && (
          <RenameModal
            handleCancel={handleRenameFileCancel}
            currentNode={currentNode}
          />
        )}
      </div>
    </PageContainer>
  );
};

export default Script;
